import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync } from 'node:fs';
import { basename } from 'node:path';
import { combine, record, routes, summarize } from './latencias.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);
function integer(name, fallback, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Valor inválido em ' + name);
  return value;
}
function originOf(value) {
  if (!/^https?:\/\/[^/?#@\s\\]+\/?$/i.test(value) || !URL.canParse(value)) throw new Error('Origem inválida');
  const url = new URL(value);
  if (url.port === '0') throw new Error('Origem inválida');
  return url.origin;
}
const base = originOf(process.env.API_ORIGIN ?? 'http://127.0.0.1:3000');
const publicOrigin = originOf(process.env.PUBLIC_ORIGIN ?? base);
const metricsOrigins = [...new Set((process.env.METRICS_ORIGINS || base).split(',').map(originOf))];
const containers = process.env.CASSANDRA_CONTAINERS?.split(',') ?? [];
const keyspace = process.env.CASSANDRA_KEYSPACE ?? 'encurtador';
if (!containers.length || !/^[a-z][a-z0-9_]{0,47}$/.test(keyspace)) throw new Error('Informe CASSANDRA_CONTAINERS e um keyspace válido');
if (containers.some(spec => !/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/.test(spec))) {
  throw new Error('Container inválido');
}
const count = integer('CREATIONS', 10, Number.MAX_SAFE_INTEGER / 11);
const concurrency = Math.min(count, integer('CONCURRENCY', 2, 1024));
const timeout = integer('TIMEOUT_MS', 15000, 300000);
const rate = Number(process.env.CREATIONS_PER_SECOND ?? 0);
if (!Number.isFinite(rate) || rate < 0) throw new Error('CREATIONS_PER_SECOND inválido');
const nonce = randomUUID();
const stats = Object.fromEntries(routes.map(op => [op, {
  hits: 0, errors: 0, mismatchedDestinations: 0, histogram: new Map()
}]));
const destPrefix = 'https://load.example/' + nonce + '/';
const counters = ['cacheHits', 'reads', 'writes', 'readErrors', 'writeErrors'];
async function collectMetrics(origin) {
  const atUtc = new Date().toISOString();
  try {
    const response = await fetch(origin + '/internal/metrics', { redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (!response.ok) {
      await response.body?.cancel();
      return { atUtc, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { atUtc, error: 'JSON sem objeto de métricas' };
    return {
      atUtc, processId: data.processId, uptime: data.uptimeSeconds, cacheHits: data.cacheHits,
      reads: data.operations?.cqlRead?.count, readErrors: data.operations?.cqlRead?.errors,
      writes: data.operations?.cqlWrite?.count, writeErrors: data.operations?.cqlWrite?.errors,
    };
  } catch (error) {
    return { atUtc, error: error instanceof SyntaxError ? 'JSON inválido' : `Falha de rede (${error.name})` };
  }
}
function kib(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('valor KiB inválido');
  return Number(value);
}
async function collectDisk(container) {
  const atUtc = new Date().toISOString();
  // Formatos aceitos: container ou contextoDocker/container.
  const [first, second] = container.split('/');
  const args = second ? ['--context', first, 'exec', second] : ['exec', first];
  const get = async (...command) => (await exec('docker', [...args, ...command], { timeout })).stdout.trim();
  const results = await Promise.allSettled([
    get('du', '-sk', '/var/lib/cassandra/data/' + keyspace).then(out => ({ keyspaceKiB: kib(out.split(/\s+/)[0]) })),
    get('df', '-kP', '/var/lib/cassandra').then(out => {
      const [,blocks,used,available] = out.split('\n').at(-1).trim().split(/\s+/);
      return { filesystemKiB: kib(blocks), usedKiB: kib(used), availableKiB: kib(available) };
    }),
  ]);
  const row = { container, atUtc };
  const errors = [];
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') Object.assign(row, result.value);
    else {
      const { code, killed, message } = result.reason;
      // Evite incluir no relatório o stderr completo do daemon ou do endpoint remoto.
      const reason = killed ? 'timeout' : code !== undefined ? `código ${code}` : message;
      errors.push(`${['du', 'df'][i]}: ${reason}`);
    }
  }
  if (errors.length) Object.assign(row, { inconclusive: true, reason: errors.join(', ') });
  return row;
}
async function snapshot() {
  const [apis, disks] = await Promise.all([
    Promise.all(metricsOrigins.map(collectMetrics)), Promise.all(containers.map(collectDisk)),
  ]);
  return { apis, disks };
}
function post(route, body) {
  return fetch(base + route, {method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(timeout)});
}
async function measured(operation, action) {
  const s = stats[operation], begin = performance.now();
  try {
    const result = await action();
    s.hits++;
    return result;
  } catch {
    s.errors++;
    return null;
  } finally {
    record(s.histogram, performance.now() - begin);
  }
}

const before = await snapshot();
for (const [i, reading] of before.apis.entries()) {
  if (reading.error) throw new Error(`Coleta inicial de ${metricsOrigins[i]}: ${reading.error}`);
}
for (const disk of before.disks) {
  if (disk.inconclusive) throw new Error(`Coleta inicial de ${disk.container}: ${disk.reason}`);
}
// O arquivo informado pertence a uma única execução. Sem ele, o SQLite usa um banco temporário.
const codesFile = process.env.CODES_FILE;
if (codesFile) closeSync(openSync(codesFile, 'wx', 0o600));
const codes = new DatabaseSync(codesFile || '');
codes.exec('PRAGMA cache_size = -8192; BEGIN; CREATE TABLE seen (code TEXT PRIMARY KEY) WITHOUT ROWID');
const rememberCode = codes.prepare('INSERT INTO seen VALUES (?) ON CONFLICT(code) DO NOTHING');
let reusedCodes = 0;
let firstRepeatedCode = null;
const start = performance.now();
const startUtc = new Date().toISOString();
let next = 0;
async function worker() {
  for (;;) {
    const id = next++;
    if (id >= count) return;
    const wait = rate ? start + id * 1000 / rate - performance.now() : 0;
    if (wait > 0) await sleep(wait);
    const destination = (destPrefix + id + '/').padEnd(100, 'a');
    const short = await measured('create', async () => {
      const r = await post('/api/v1/encurtar', {url: destination});
      const body = await r.text();
      if (r.status !== 201) throw new Error('HTTP');
      const url = JSON.parse(body)?.short_url;
      if (typeof url !== 'string' || !url.startsWith(publicOrigin)) throw new Error('Link');
      const path = url.slice(publicOrigin.length);
      if (!/^\/[A-Za-z0-9]{7}$/.test(path)) throw new Error('Link');
      return { url, path };
    });
    if (!short) continue;
    // O índice fica fora do cronômetro HTTP. Reclassifique o 201 repetido como falha.
    const code = short.path.slice(1);
    if (rememberCode.run(code).changes === 0) {
      reusedCodes++;
      firstRepeatedCode ??= code;
      stats.create.hits--;
      stats.create.errors++;
      continue;
    }
    for (let read = 0; read < 10; read++) {
      const operation = read % 2 ? 'resolvePost' : 'resolveGet';
      await measured(operation, async () => {
        const r = read % 2 ? await post('/api/v1/redirecionar', {short_url: short.url}) :
          await fetch(base + short.path, {redirect:'manual', signal: AbortSignal.timeout(timeout)});
        await r.arrayBuffer();
        if (r.status !== 302 || r.headers.get('cache-control') !== 'no-store') throw new Error('Redirecionamento');
        if (r.headers.get('location') !== destination) {
          stats[operation].mismatchedDestinations++;
          throw new Error('Destino');
        }
      });
    }
  }
}
await Promise.all(Array.from({length: concurrency}, worker));
const seconds = (performance.now() - start) / 1000;
const finishUtc = new Date().toISOString();
let codeLedger;
if (codesFile) {
  codes.exec('CREATE TABLE sample (id TEXT, origin TEXT, reused INTEGER)');
  codes.prepare('INSERT INTO sample VALUES (?, ?, ?)').run(nonce, publicOrigin, reusedCodes);
  codes.exec('COMMIT');
  codeLedger = { file: basename(codesFile), id: nonce, origin: publicOrigin };
}
codes.close();
const after = await snapshot();
const metricProcesses = new Map();
const metrics = after.apis.map((last, i) => {
  const first = before.apis[i];
  const row = { replica: metricsOrigins[i], before: first, after: last };
  const ids = [first.processId, last.processId].filter(id => typeof id === 'string' && id.trim());
  for (const id of new Set(ids)) {
    if (!metricProcesses.has(id)) metricProcesses.set(id, { processId: id, origins: [], countedAt: null });
    metricProcesses.get(id).origins.push(row.replica);
  }
  if (last.error) return { ...row, inconclusive: true, reason: `Coleta final: ${last.error}` };
  if (ids.length !== 2) {
    return { ...row, inconclusive: true, reason: 'Coleta sem identificador de processo' };
  }
  if (first.processId !== last.processId) return { ...row, inconclusive: true, reason: 'O processo mudou entre as coletas' };
  const validUptime = Number.isFinite(first.uptime) && Number.isFinite(last.uptime) &&
    first.uptime >= 0 && last.uptime >= first.uptime;
  const validCounts = counters.every(key => Number.isSafeInteger(first[key]) && Number.isSafeInteger(last[key]) &&
    first[key] >= 0 && last[key] >= first[key]);
  if (!validUptime || !validCounts) {
    return { ...row, inconclusive: true, reason: 'Uptime ou contador inválido' };
  }
  const identity = metricProcesses.get(last.processId);
  if (identity.countedAt) return { ...row, processId: last.processId, countedAt: identity.countedAt };
  identity.countedAt = row.replica;
  return { ...row, processId: last.processId, ...Object.fromEntries(counters.map(key => [key, last[key] - first[key]])) };
});
const sharedMetricProcesses = [...metricProcesses.values()].filter(entry => entry.origins.length > 1);
const operations = Object.fromEntries(routes.map(route => {
  const s = stats[route];
  return [route, summarize(s.histogram, s.hits, s.errors, s.mismatchedDestinations)];
}));
operations.resolve = combine([operations.resolveGet, operations.resolvePost]);
for (const op of Object.values(operations)) op.confirmedPerSecond = op.confirmed / seconds;
console.log(JSON.stringify({startUtc, finishUtc, seconds, concurrency, destinationBytes:100, requestedCreations:count, 
  reusedCodes, firstRepeatedCode, codeLedger, resolutionsSkipped:10*(count-stats.create.hits), operations, metrics, sharedMetricProcesses,
  diskBefore:before.disks, diskAfter:after.disks}, null, 2));
const partial = [...metrics, ...after.disks].some(row => row.inconclusive);
if (stats.create.errors || operations.resolve.failures || partial) process.exitCode = 1;
