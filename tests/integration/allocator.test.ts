import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryOptions } from 'cassandra-driver';
import { createCodec, FIRST_ID } from '../../src/ids/codec.js';
import { createIssuer } from '../../src/ids/allocator.js';
import { administer, ROW } from '../../src/ids/recovery.js';
import { creator } from '../../src/links/create.js';
import { resolver } from '../../src/links/resolve.js';
import { reserveBlock } from '../../src/storage/allocator.js';
import { readLink } from '../../src/storage/read.js';
import { writeLink } from '../../src/storage/write.js';
import { start, post } from '../contract/http.js';
import { withDatabase } from './database.js';

test('dois emissores, reinício e resposta LWT perdida preservam a exclusividade dos blocos', async () => {
  await withDatabase(async ({ client, config, newClient }) => {
    config.blockSize = 4n;
    const limit = FIRST_ID + 41n;
    await administer(client, config, 'init', limit);
    const codec = createCodec(config.key, config.tweak);
    const a = createIssuer(client, config), b = createIssuer(newClient(), config);
    const start = await Promise.all(Array.from({length:12}, (_, i) => (i % 2 ? a : b).nextCode()));
    assert.equal(new Set(start).size, 12);
    assert.ok(start.map(codec.decode).includes(FIRST_ID));
    const abandoned = a.remaining() + b.remaining();
    assert.equal(abandoned, 4n);
    let lostStart = 0n;
    const ambiguous = createIssuer(client, config, async marker => {
      const reserved = await reserveBlock(client, config.consistency, config.blockSize, marker);
      lostStart = reserved.start;
      throw new Error('Resposta LWT perdida após commit');
    });
    await assert.rejects(ambiguous.nextCode(), /Resposta LWT perdida/);
    const fresh = createIssuer(newClient(), config);
    const more: string[] = [];
    for (let pos = lostStart + 4n; pos < limit; pos++) {
      const code = await fresh.nextCode();
      assert.equal(codec.decode(code), pos);
      more.push(code);
    }
    await assert.rejects(fresh.nextCode(), /esgotada/);
    assert.equal(new Set([...start, ...more]).size, start.length + more.length);
    const row = (await client.execute('SELECT next_free,authorized_until FROM reservations WHERE installation=?', [ROW], {prepare:true})).first();
    assert.equal(typeof row.next_free, 'bigint');
    assert.equal(row.next_free, limit);
    assert.equal(row.authorized_until, limit);
    const mismatch = createIssuer(client, { ...config, key: Buffer.alloc(32, 19) });
    await assert.rejects(mismatch.nextCode(), /Marca externa inválida/);
  });
});

test('marca externa que retrocede bloqueia o saldo local, novas reservas e a ampliação do teto', async () => {
  const { readFile, writeFile } = await import('node:fs/promises');
  await withDatabase(async ({ client, config }) => {
    config.blockSize = 4n;
    await administer(client, config, 'init', FIRST_ID + 1n);
    const obsolete = await readFile(config.markerFile);
    const issuer = createIssuer(client, config);
    await issuer.nextCode();
    await administer(client, config, 'extend', FIRST_ID + 10n);
    await issuer.nextCode();
    const current = await readFile(config.markerFile);
    assert.equal(issuer.remaining(), 3n);
    await writeFile(config.markerFile, obsolete);
    await assert.rejects(issuer.nextCode());
    await assert.rejects(createIssuer(client, config).nextCode());
    await assert.rejects(administer(client, config, 'extend', FIRST_ID + 20n));
    assert.deepEqual(await readFile(config.markerFile), obsolete);
    await writeFile(config.markerFile, current);
    assert.equal(createCodec(config.key, config.tweak).decode(await issuer.nextCode()), FIRST_ID + 2n);
  });
});

test('a última reserva sem resposta alerta na leitura seguinte e conserva o vínculo por GET e POST', async t => {
  await withDatabase(async ({ client, config }) => {
    const cap = FIRST_ID + 2n;
    config.blockSize = 1n;
    await administer(client, config, 'init', cap);
    const issuer = createIssuer(client, config);
    const origin = await start(t, {
      origin: config.origin,
      create: creator(issuer.nextCode, link => writeLink(client, config.consistency, link)),
      resolve: resolver({ get: async () => null, put: async () => {} }, code => readLink(client, config.consistency, code))
    });
    const create = (url: string) => post(origin, '/api/v1/encurtar', JSON.stringify({ url }));
    const destination = 'https://loja.example/a%2Fb?cor=azul%20claro&x=%2b#saldo';
    const saved = await create(destination);
    assert.equal(saved.status, 201);
    const { short_url: short } = await saved.json() as { short_url: string };
    const warnings = t.mock.method(console, 'warn', () => {});
    let lose = true;
    const execute = client.execute.bind(client);
    t.mock.method(client, 'execute', async (query: string, params: unknown[], options: QueryOptions) => {
      const result = await execute(query, params, options);
      if (lose && query.startsWith('UPDATE reservations SET next_free=') && result.wasApplied()) {
        lose = false;
        throw new Error('Resposta da última LWT perdida depois de aplicada');
      }
      return result;
    });
    async function refused() {
      const response = await create('https://loja.example/novo');
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    await refused();
    assert.equal(lose, false);
    const row = (await client.execute('SELECT next_free, authorized_until FROM reservations WHERE installation=?', [ROW], {prepare:true})).first();
    assert.equal(row.next_free, cap);
    assert.equal(row.authorized_until, cap);
    assert.equal((await client.execute('SELECT count(*) FROM links')).first().count, 1n);
    assert.equal(warnings.mock.callCount(), 0);
    await refused();
    assert.equal(warnings.mock.callCount(), 1, 'a leitura confirmou que a faixa foi consumida');
    assert.match(String(warnings.mock.calls[0].arguments[0]), /esgotad/i);
    await refused();
    assert.equal(warnings.mock.callCount(), 1);

    for (const response of [
      await fetch(origin + new URL(short).pathname, {redirect:'manual'}),
      await post(origin, '/api/v1/redirecionar', JSON.stringify({short_url:short}))
    ]) {
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), destination);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }

    await administer(client, config, 'extend', cap + 1n);
    const normal = await create('https://loja.example/novo-teto');
    assert.equal(normal.status, 201);
    const newShort = ((await normal.json()) as { short_url: string }).short_url;
    assert.equal(createCodec(config.key, config.tweak).decode(new URL(newShort).pathname.slice(1)), cap);
    assert.equal(warnings.mock.callCount(), 2);
    assert.match(String(warnings.mock.calls[1].arguments[0]), /último bloco/i);
    await refused();
    await refused();
    assert.equal(warnings.mock.callCount(), 2);
  });
});
