import { isIP } from 'node:net';
import { resolve } from 'node:path';
import cassandra from 'cassandra-driver';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  function fail(name: string): never {
    throw new Error(`Configuração inválida em ${name}`);
  }
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name] ?? String(fallback);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) fail(name);
    return value;
  }
  function url(name: string, fallback?: string) {
    try { return new URL(env[name] ?? fallback ?? ''); } catch { return fail(name); }
  }
  function token(name: string, fallback: string, pattern: RegExp) {
    const value = env[name] ?? fallback;
    if (!pattern.test(value)) fail(name);
    return value;
  }
  const origin = url('PUBLIC_ORIGIN');
  if (!/^https?:$/.test(origin.protocol) || origin.port === '0' ||
      !/^https?:\/\/[^/?#@\s\\]+\/?$/i.test(env.PUBLIC_ORIGIN ?? '')) fail('PUBLIC_ORIGIN');
  const redisUrl = url('REDIS_URL', 'redis://127.0.0.1:6379');
  if (!['redis:', 'rediss:'].includes(redisUrl.protocol) || !redisUrl.hostname ||
      /%(?![0-9a-f]{2})/i.test(redisUrl.hostname) || redisUrl.port === '0' ||
      redisUrl.search || redisUrl.hash) fail('REDIS_URL');
  if (!/^(?:\/\d*)?$/.test(redisUrl.pathname) ||
      !Number.isSafeInteger(Number(redisUrl.pathname.slice(1)))) fail('REDIS_URL');
  try {
    decodeURIComponent(redisUrl.username);
    decodeURIComponent(redisUrl.password);
  } catch {
    fail('REDIS_URL');
  }
  const contactPoints = (env.CASSANDRA_CONTACT_POINTS ?? '127.0.0.1').split(',').map(s => s.trim());
  for (const host of contactPoints) {
    if (isIP(host)) continue;
    const name = host.endsWith('.') ? host.slice(0, -1) : host;
    const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    if (name.length > 253 || !name.split('.').every(label => dnsLabel.test(label))) fail('CASSANDRA_CONTACT_POINTS');
  }
  const consistencyName = token('CASSANDRA_CONSISTENCY', 'ONE', /^(ONE|LOCAL_QUORUM)$/);
  const keyHex = token('FF1_KEY', '', /^(?:[a-f\d]{32}|[a-f\d]{48}|[a-f\d]{64})$/i);
  const tweakHex = token('FF1_TWEAK', '', /^(?:[a-f\d]{2}){0,256}$/i);
  const username = env.CASSANDRA_USERNAME, password = env.CASSANDRA_PASSWORD;
  if (Boolean(username) !== Boolean(password)) fail('CASSANDRA_USERNAME / CASSANDRA_PASSWORD');
  return {
    origin: origin.origin,
    port: integer('PORT', 3000, 1, 65535),
    contactPoints,
    cassandraPort: integer('CASSANDRA_PORT', 9042, 1, 65535),
    datacenter: token('CASSANDRA_DATACENTER', 'datacenter1', /^[A-Za-z0-9_.-]+$/),
    keyspace: token('CASSANDRA_KEYSPACE', 'encurtador', /^[a-z][a-z0-9_]{0,47}$/),
    credentials: username && password ? { username, password } : undefined,
    consistency: consistencyName === 'ONE' ? cassandra.types.consistencies.one : cassandra.types.consistencies.localQuorum,
    redisUrl: redisUrl.toString(),
    key: Uint8Array.from(Buffer.from(keyHex, 'hex')),
    tweak: Uint8Array.from(Buffer.from(tweakHex, 'hex')),
    installation: token('INSTALLATION_ID', 'encurtador', /^[A-Za-z0-9_-]{1,80}$/),
    blockSize: BigInt(integer('ID_BLOCK_SIZE', 1024, 1, 62 ** 7)),
    cacheTtlSeconds: integer('CACHE_TTL_SECONDS', 3600, 1, 31536000),
    cacheTimeoutMs: integer('CACHE_TIMEOUT_MS', 100, 1, 60000),
    timeoutMs: integer('DB_TIMEOUT_MS', 5000, 1, 120000),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 15000, 1, 300000),
    clockToleranceSeconds: integer('CLOCK_TOLERANCE_SECONDS', 5, 0, 3600),
    markerFile: resolve(env.EMISSION_MARKER_FILE || '/run/encurtador/emission.json'),
    issueEnabled: token('ISSUE_ENABLED', 'true', /^(true|false)$/) === 'true',
  };
}
export type Config = ReturnType<typeof loadConfig>;
