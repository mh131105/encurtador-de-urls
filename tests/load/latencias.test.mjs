import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

async function setupSample(t) {
  const dir = await mkdtemp(join(tmpdir(), 'encurtador-latencias-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Só du e df de um contêiner descartável são simulados na coleta de disco.
  await writeFile(join(dir, 'docker'), `#!/bin/sh
file="$ESTADO_DISCO-$2-$3"
phase=inicial
if [ -f "$file" ]; then phase=final; else touch "$file"; fi
if [ "$2:$3:$phase" = "$FALHA_DISCO" ]; then exit 7; fi
if [ "$2:$3:$phase" = "$DISCO_INVALIDO" ]; then echo 'medição inválida'; exit 0; fi
case "$3" in
  du) echo '10 /var/lib/cassandra/data/encurtador' ;;
  df) echo '/dev/teste 100 10 90 10% /var/lib/cassandra' ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  let samples = 0;
  function sample(count, factor, {
    failures = false, snapshots = {}, status = failures ? 1 : 0, shortPath = '',
    containers = 'banco-de-teste', diskFailure = '', malformedDisk = '', initialFailure, codesFile = '',
    apiOrigin = 'http://amostra.test', publicOrigin = apiOrigin, returnedLink = '',
  } = {}) {
    const result = spawnSync(process.execPath, ['--import', './respostas-controladas.mjs', 'amostra.mjs'], {
      cwd: import.meta.dirname, encoding: 'utf8',
      env: { PATH: dir + delimiter + process.env.PATH, API_ORIGIN: apiOrigin, PUBLIC_ORIGIN: publicOrigin,
        CASSANDRA_CONTAINERS: containers, FALHA_DISCO: diskFailure, DISCO_INVALIDO: malformedDisk,
        ESTADO_DISCO: join(dir, `disco-${++samples}`), CREATIONS: String(count), CONCURRENCY: '1', CODES_FILE: codesFile,
        REGISTRAR_CRIACAO: initialFailure ? '1' : '',
        FATOR_LATENCIA: String(factor), FALHAS_AMOSTRA: failures ? '1' : '0', CAMINHO_CURTO: shortPath, LINK_RETORNADO: returnedLink,
        METRICS_ORIGINS: Object.keys(snapshots).join(','), COLETAS_METRICAS: JSON.stringify(snapshots) }
    });
    assert.equal(result.status, status, result.stderr);
    if (initialFailure) {
      assert.match(result.stderr, initialFailure);
      assert.doesNotMatch(result.stderr, /POST de criação recebido/);
      assert.equal(result.stdout, '');
      return;
    }
    return JSON.parse(result.stdout);
  }
  return { dir, sample };
}

test('combina as distribuições por rota de dois geradores e contabiliza falhas', async t => {
  const { dir, sample } = await setupSample(t);
  const a = sample(19, 1);
  const b = sample(1, 10);
  for (const [report, count, factor] of [[a, 19, 1], [b, 1, 10]]) {
    assert.equal(report.operations.create.confirmed, count);
    assert.equal(report.operations.resolve.confirmed, count * 10);
    assert.equal(report.operations.resolve.failures, 0);
    for (const [name, attempts, ms] of [['create', count, 2], ['resolveGet', count * 5, 4], ['resolvePost', count * 5, 8]]) {
      assert.deepEqual(report.operations[name]?.bucketsUs, [[ms * factor * 1000, attempts]], name);
    }
  }

  const files = [join(dir, 'a.json'), join(dir, 'b.json')];
  await Promise.all([a, b].map((report, i) => writeFile(files[i], JSON.stringify(report))));
  const combined = spawnSync(process.execPath, ['combinar.mjs', ...files], { cwd: import.meta.dirname, encoding: 'utf8' });
  assert.equal(combined.status, 0, combined.stderr);
  const { operations } = JSON.parse(combined.stdout);
  for (const [name, attempts, p95, p99] of [['create', 20, 2, 20], ['resolveGet', 100, 4, 40], ['resolvePost', 100, 8, 80]]) {
    const op = operations[name];
    assert.equal(op.confirmed, attempts);
    assert.equal(op.p95Ms, p95, name);
    assert.equal(op.p99Ms, p99, name);
  }
  assert.equal(operations.resolve.confirmed, 200);

  const failed = sample(2, 1, { failures: true });
  assert.equal(failed.resolutionsSkipped, 10);
  assert.equal(failed.operations.create.failures, 1);
  assert.deepEqual(failed.operations.create.bucketsUs, [[2000, 2]]);
  assert.equal(failed.operations.resolveGet.failures, 1);
  assert.equal(failed.operations.resolveGet.mismatchedDestinations, 1);
  assert.deepEqual(failed.operations.resolveGet.bucketsUs, [[4000, 5]]);
  assert.equal(failed.operations.resolvePost.confirmed, 5);
  assert.equal(failed.operations.resolve.confirmed, 9);
});

test('compara contadores por processo e preserva os totais do cliente em janela inconclusiva', async t => {
  const { sample } = await setupSample(t);
  const before = {
    processId: 'a0c408b1-8b01-405b-9081-e194bfe2b09b', uptimeSeconds: 10, cacheHits: 40,
    operations: { cqlRead: { count: 12, errors: 1 }, cqlWrite: { count: 6, errors: 0 } }
  };
  const after = {
    processId: before.processId, uptimeSeconds: 70, cacheHits: 56,
    operations: { cqlRead: { count: 16, errors: 2 }, cqlWrite: { count: 8, errors: 1 } }
  };
  const stable = 'http://estavel.test', restarted = 'http://reiniciada.test', legacy = 'http://legada.test';
  const regressed = 'http://contador-invalido.test';
  const snapshots = { [stable]: [before, after] };
  const valid = sample(2, 1, { snapshots });
  const mixed = sample(2, 1, { status: 1, snapshots: {
    ...snapshots,
    [restarted]: [{ ...before, processId: '616be4ae-7429-4ab7-9d74-8b3472b82b35' },
      { ...after, processId: '51be2d48-04b0-4a38-9445-fa0f3787cd5b' }],
    [legacy]: [{ ...before, processId: undefined }, { ...after, processId: undefined }],
    [regressed]: [{ ...before, processId: 'regredida' }, { ...after, processId: 'regredida', cacheHits: before.cacheHits - 1 }]
  } });
  const deltas = { cacheHits: 16, reads: 4, writes: 2, readErrors: 1, writeErrors: 1 };
  for (const report of [valid, mixed]) {
    assert.equal(report.operations.create.confirmed, 2);
    assert.equal(report.operations.resolveGet.confirmed, 10);
    assert.equal(report.operations.resolvePost.confirmed, 10);
    assert.equal(report.operations.resolve.confirmed, 20);
    assert.equal(report.operations.resolve.failures, 0);
    const metrics = report.metrics.find(row => row.replica === stable);
    for (const [key, expected] of Object.entries(deltas)) assert.equal(metrics[key], expected, key);
  }
  for (const origin of [restarted, legacy, regressed]) {
    const row = mixed.metrics.find(entry => entry.replica === origin);
    assert.equal(row.inconclusive, true, origin);
    assert.ok(row.reason, origin);
    for (const key of Object.keys(deltas)) assert.equal(Object.hasOwn(row, key), false, key);
  }
});

test('conta apenas o caminho literal do link retornado pela criação', async t => {
  const { sample } = await setupSample(t);
  const invalid = sample(1, 1, { shortPath: '/sub/../0000001', status: 1 });
  assert.equal(invalid.operations.create.confirmed, 0);
  assert.equal(invalid.operations.create.failures, 1);
  assert.equal(invalid.resolutionsSkipped, 10);
  assert.equal(invalid.metrics[0].reads, 0);
  for (const name of ['resolveGet', 'resolvePost']) {
    assert.equal(invalid.operations[name].confirmed, 0);
    assert.equal(invalid.operations[name].failures, 0);
    assert.deepEqual(invalid.operations[name].bucketsUs, []);
  }

  const valid = sample(1, 1, { shortPath: '/0000001' });
  assert.equal(valid.operations.create.confirmed, 1);
  assert.equal(valid.operations.create.failures, 0);
  assert.equal(valid.resolutionsSkipped, 0);
  assert.equal(valid.operations.resolveGet.confirmed, 5);
  assert.equal(valid.operations.resolvePost.confirmed, 5);
  assert.equal(valid.operations.resolve.failures, 0);
  assert.equal(valid.metrics[0].reads, 10);
});

test('usa a origem canônica no 201 e a entrada configurada nas dez resoluções', async t => {
  const { dir, sample } = await setupSample(t);
  const publicOrigin = 'https://S.Example:443';
  const returnedLink = 'https://s.example/Abc1234';
  for (const [index, apiOrigin] of [publicOrigin, 'http://PRIVADA.test:8080/'].entries()) {
    const report = sample(1, 1, {
      apiOrigin, publicOrigin, returnedLink, codesFile: join(dir, `origem-${index}.sqlite`),
    });
    assert.equal(report.codeLedger.origin, 'https://s.example');
    assert.equal(report.metrics[0].replica, new URL(apiOrigin).origin);
    assert.equal(report.metrics[0].reads, 10);
    assert.equal(report.resolutionsSkipped, 0);
    for (const [route, confirmed] of [['create', 1], ['resolveGet', 5], ['resolvePost', 5]]) {
      assert.equal(report.operations[route].confirmed, confirmed);
      assert.equal(report.operations[route].failures, 0);
      assert.equal(report.operations[route].mismatchedDestinations, 0);
    }
  }
  for (const returnedLink of ['https://outra.example/Abc1234', 'https://s.example:444/Abc1234',
    'https://s.example/p/../Abc1234', 'https://s.example/%41bc1234']) {
    const report = sample(1, 1, {apiOrigin: publicOrigin, publicOrigin, returnedLink, status: 1});
    assert.equal(report.operations.create.failures, 1);
    assert.equal(report.resolutionsSkipped, 10);
    assert.equal(report.metrics[0].reads, 0);
  }
  for (const apiOrigin of ['https://s.example/p/..', 'https://s.example?', 'https://s.example#',
    'https://usuario@s.example', 'https://s.example:0']) {
    sample(1, 1, {apiOrigin, status: 1, initialFailure: /Origem inválida/});
  }
});

test('rejeita a reutilização de código para dois destinos na mesma amostra', async t => {
  const { sample } = await setupSample(t);
  const reused = sample(2, 1, { shortPath: '/aB00001', status: 1 });
  assert.equal(reused.reusedCodes, 1);
  assert.equal(reused.firstRepeatedCode, 'aB00001');
  assert.equal(reused.operations.create.confirmed, 1);
  assert.equal(reused.operations.create.failures, 1);
  assert.equal(reused.resolutionsSkipped, 10);
  assert.equal(reused.operations.resolveGet.confirmed, 5);
  assert.equal(reused.operations.resolvePost.confirmed, 5);
  assert.equal(reused.operations.resolve.failures, 0);
  assert.equal(reused.metrics[0].writes, 2);
  assert.equal(reused.metrics[0].reads, 10);

  const distinct = sample(2, 1);
  assert.equal(distinct.reusedCodes, 0);
  assert.equal(distinct.firstRepeatedCode, null);
  assert.equal(distinct.operations.create.confirmed, 2);
  assert.equal(distinct.operations.create.failures, 0);
  assert.equal(distinct.resolutionsSkipped, 0);
  assert.equal(distinct.operations.resolveGet.confirmed, 10);
  assert.equal(distinct.operations.resolvePost.confirmed, 10);
  assert.equal(distinct.operations.resolve.failures, 0);
  assert.equal(distinct.metrics[0].reads, 20);
});

test('confere códigos de geradores e janelas distintas antes de aprovar seus totais', async t => {
  const { dir, sample } = await setupSample(t);
  async function saved(name, code, options = {}) {
    const file = join(dir, name + '.json');
    const report = sample(1, 1, { shortPath: '/' + code, codesFile: join(dir, name + '.sqlite'), ...options });
    await writeFile(file, JSON.stringify(report));
    return file;
  }
  function merge(...args) {
    const result = spawnSync(process.execPath, ['combinar.mjs', ...args], { cwd: import.meta.dirname, encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr);
    return { status: result.status, ...JSON.parse(result.stdout) };
  }
  const first = await saved('a', '00000Aa');
  const second = await saved('b', '00000aA', { apiOrigin: 'http://outra-entrada.test', publicOrigin: 'http://amostra.test' });
  const third = await saved('c', '00000Aa');
  const valid = merge('--require-unique', first, second);
  assert.equal(valid.status, 0);
  assert.equal(valid.codeUniqueness.status, 'verified');
  assert.equal(valid.codeUniqueness.distinct, 2);
  assert.equal(valid.operations.resolve.confirmed, 20);
  const duplicate = merge(first, second, third);
  assert.equal(duplicate.status, 1);
  assert.equal(duplicate.codeUniqueness.status, 'reused');
  assert.equal(duplicate.codeUniqueness.distinct, 2);
  assert.equal(duplicate.codeUniqueness.repeatedAcrossSamples, 1);
  assert.equal(duplicate.codeUniqueness.firstRepeated.code, '00000Aa');
  const otherOrigin = await saved('outra', 'ABCdef0', { publicOrigin: 'https://outra-instalacao.test' });
  const mixedOrigins = merge('--require-unique', first, otherOrigin);
  assert.equal(mixedOrigins.status, 1);
  assert.equal(mixedOrigins.codeUniqueness.status, 'unverified');
  assert.match(mixedOrigins.codeUniqueness.reason, /origens públicas/i);
  const historical = join(dir, 'historica.json');
  await writeFile(historical, JSON.stringify({ operations: valid.operations }));
  const latencyOnly = merge(first, historical);
  assert.equal(latencyOnly.status, 0);
  assert.equal(latencyOnly.codeUniqueness.status, 'unverified');
  assert.equal(latencyOnly.operations.resolve.confirmed, 30);
  assert.equal(merge('--require-unique', first, historical).status, 1);
  // Um índice de outra amostra pode ter a mesma quantidade de linhas.
  const swapped = join(dir, 'trocada.json');
  const wrong = JSON.parse(await readFile(second, 'utf8'));
  wrong.codeLedger.file = 'c.sqlite';
  await writeFile(swapped, JSON.stringify(wrong));
  assert.equal(merge('--require-unique', first, swapped).status, 1);
  sample(1, 1, { codesFile: join(dir, 'a.sqlite'), initialFailure: /EEXIST/, status: 1 });
  await rm(join(dir, 'c.sqlite'));
  assert.equal(merge('--require-unique', first, third).status, 1);
});

test('contabiliza o mesmo processo uma vez em origens distintas, inclusive nas coletas parciais', async t => {
  const { sample } = await setupSample(t);
  const a = 'http://api-a.test', alias = 'http://alias-a.test', b = 'http://api-b.test';
  const snapshot = (processId, reads = 0, writes = 0, cacheHits = 0) => ({
    processId, uptimeSeconds: 10 + reads, cacheHits,
    operations: { cqlRead: { count: reads, errors: 0 }, cqlWrite: { count: writes, errors: 0 } },
  });
  const initial = snapshot('A'), final = snapshot('A', 10, 1);
  function checkTraffic(report) {
    assert.equal(report.operations.create.confirmed, 1);
    assert.equal(report.operations.resolveGet.confirmed, 5);
    assert.equal(report.operations.resolvePost.confirmed, 5);
    assert.equal(report.operations.resolve.failures, 0);
  }
  const same = sample(1, 1, { snapshots: { [a]: [initial, final], [alias]: [initial, final] } });
  checkTraffic(same);
  assert.deepEqual(same.metrics.map(row => row.replica), [a, alias]);
  assert.equal(same.metrics.reduce((n, row) => n + (row.reads ?? 0), 0), 10);
  assert.equal(same.metrics.reduce((n, row) => n + (row.writes ?? 0), 0), 1);
  assert.equal(same.metrics[0].cacheHits, 0);
  assert.deepEqual(same.sharedMetricProcesses, [{ processId: 'A', origins: [a, alias], countedAt: a }]);
  for (const key of ['cacheHits', 'reads', 'writes', 'readErrors', 'writeErrors']) {
    assert.equal(Object.hasOwn(same.metrics[1], key), false);
  }
  assert.equal(same.metrics[1].before.processId, 'A');
  assert.equal(same.metrics[1].after.reads, 10);
  assert.equal(same.metrics[1].countedAt, a);

  const repeated = sample(1, 1, { snapshots: { [a]: [initial, final], [a + '/']: [] } });
  checkTraffic(repeated);
  assert.deepEqual(repeated.metrics.map(row => [row.replica, row.reads, row.writes]), [[a, 10, 1]]);
  assert.deepEqual(repeated.sharedMetricProcesses, []);

  const withCacheAndErrors = {
    processId: 'A', uptimeSeconds: 40, cacheHits: 3,
    operations: { cqlRead: { count: 18, errors: 1 }, cqlWrite: { count: 3, errors: 1 } },
  };
  const cached = sample(1, 1, { snapshots: {
    [a]: [final, withCacheAndErrors], [alias]: [final, withCacheAndErrors],
  } });
  checkTraffic(cached);
  for (const [key, delta] of Object.entries({ cacheHits: 3, reads: 8, writes: 2, readErrors: 1, writeErrors: 1 })) {
    assert.equal(cached.metrics[0][key], delta, key);
    assert.equal(Object.hasOwn(cached.metrics[1], key), false, key);
  }

  const both = sample(1, 1, { snapshots: {
    [a]: [initial, snapshot('A', 6, 1)], [b]: [snapshot('B'), snapshot('B', 4)],
  } });
  checkTraffic(both);
  assert.deepEqual(both.sharedMetricProcesses, []);
  assert.deepEqual(both.metrics.map(row => [row.reads, row.writes]), [[6, 1], [4, 0]]);

  for (const ends of [[initial, 503], [snapshot('anterior'), final], [initial, { ...final, processId: null }]]) {
    const partial = sample(1, 1, { status: 1, snapshots: {
      [alias]: ends, [a]: [initial, snapshot('A', 7, 1, 3)], [b]: [snapshot('B'), snapshot('B', 2, 0, 1)],
    } });
    checkTraffic(partial);
    assert.deepEqual(partial.sharedMetricProcesses, [{ processId: 'A', origins: [alias, a], countedAt: a }]);
    assert.ok(partial.metrics[0].inconclusive);
    assert.ok(partial.metrics[0].reason);
    assert.equal(Object.hasOwn(partial.metrics[0], 'reads'), false);
    assert.deepEqual(partial.metrics.slice(1).map(row => [row.reads, row.writes, row.cacheHits]), [[7, 1, 3], [2, 0, 1]]);
  }

  const ambiguous = sample(1, 1, { status: 1, snapshots: {
    [a]: [initial, 503], [alias]: [snapshot('anterior'), final],
  } });
  checkTraffic(ambiguous);
  assert.deepEqual(ambiguous.sharedMetricProcesses, [{ processId: 'A', origins: [a, alias], countedAt: null }]);
  assert.ok(ambiguous.metrics.every(row => row.inconclusive && !Object.hasOwn(row, 'reads')));
});

test('preserva as operações e as coletas disponíveis quando falha a telemetria', async t => {
  const { sample } = await setupSample(t);
  const initial = {
    processId: 'replica-A', uptimeSeconds: 4, cacheHits: 8,
    operations: { cqlRead: { count: 4, errors: 0 }, cqlWrite: { count: 3, errors: 0 } },
  };
  const final = {
    ...initial, uptimeSeconds: 11, cacheHits: 15,
    operations: { cqlRead: { count: 7, errors: 1 }, cqlWrite: { count: 4, errors: 0 } },
  };
  const stable = 'http://estavel.test';
  const missing = 'http://indisponivel.test';
  function checkTraffic(report) {
    for (const [name, attempts, micros] of [['create', 1, 2000], ['resolveGet', 5, 4000], ['resolvePost', 5, 8000]]) {
      assert.equal(report.operations[name].confirmed, attempts, name);
      assert.equal(report.operations[name].failures, 0, name);
      assert.deepEqual(report.operations[name].bucketsUs, [[micros, attempts]], name);
    }
    assert.equal(report.resolutionsSkipped, 0);
  }
  for (const [fault, reason] of [[503, /503/], ['rede', /rede/i], ['json truncado', /JSON/i], [null, /objeto|estrutura/i]]) {
    const report = sample(1, 1, { snapshots: {
      [stable]: [initial, final], [missing]: [{ ...initial, processId: 'replica-B' }, fault],
    }, status: 1 });
    checkTraffic(report);
    const good = report.metrics.find(row => row.replica === stable);
    assert.deepEqual([good.reads, good.readErrors, good.writes, good.writeErrors, good.cacheHits], [3, 1, 1, 0, 7]);
    const bad = report.metrics.find(row => row.replica === missing);
    assert.equal(bad.inconclusive, true);
    assert.match(bad.reason, /final/i);
    assert.match(bad.reason, reason);
    assert.equal(bad.before.cacheHits, initial.cacheHits);
    assert.ok(Number.isFinite(Date.parse(bad.before.atUtc)));
    assert.equal(Object.hasOwn(bad, 'reads'), false);
    assert.equal(report.diskAfter[0].availableKiB, 90);
  }
  const disks = sample(1, 1, { status: 1, containers: 'saudavel,parcial',
    diskFailure: 'parcial:df:final' });
  checkTraffic(disks);
  assert.equal(disks.metrics[0].reads, 10);
  for (const phase of [disks.diskBefore, disks.diskAfter]) {
    const healthy = phase.find(row => row.container === 'saudavel');
    assert.equal(healthy.keyspaceKiB, 10);
    assert.equal(healthy.availableKiB, 90);
    const partial = phase.find(row => row.container === 'parcial');
    assert.ok(Number.isFinite(Date.parse(partial.atUtc)));
  }
  const partialBefore = disks.diskBefore.find(row => row.container === 'parcial');
  assert.equal(partialBefore.availableKiB, 90);
  assert.equal(partialBefore.keyspaceKiB, 10);
  const partialAfter = disks.diskAfter.find(row => row.container === 'parcial');
  assert.equal(partialAfter.keyspaceKiB, 10);
  assert.equal(partialAfter.inconclusive, true);
  assert.equal(Object.hasOwn(partialAfter, 'availableKiB'), false);
  assert.match(partialAfter.reason, /df/);
});

test('interrompe antes das criações quando falta uma coleta inicial', async t => {
  const { sample } = await setupSample(t);
  for (const fault of [503, 'rede', 'json truncado', null]) {
    sample(1, 1, { status: 1, snapshots: { 'http://ausente.test': [fault] }, initialFailure: /inicial.*ausente\.test/i });
  }
  sample(1, 1, { status: 1, diskFailure: 'banco-de-teste:df:inicial', initialFailure: /inicial.*banco-de-teste.*df/i });
  sample(1, 1, { status: 1, malformedDisk: 'banco-de-teste:du:inicial', initialFailure: /inicial.*banco-de-teste.*du/i });
});
