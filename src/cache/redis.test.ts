import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { openRedis, RedisCache } from './redis.js';

const destination = 'https://loja.example/caf%C3%A9?q=a%2Bb#detalhes';
const code = 'k7Q2aZ9';

test('cache preserva o destino e a validade absoluta, e limita o TTL restante', async () => {
  const entries = new Map<string, string>();
  let ttl: number | undefined;
  const client = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string, options: { expiration: { type: 'PX'; value: number } }) => {
      ttl = options.expiration.value;
      entries.set(key, value);
    },
  };
  let instant = new Date('2040-01-02T00:00:00Z');
  const cache = new RedisCache(client, 'loja', 60, 100, () => instant);
  const link = { code, destination, expiresAt: new Date(instant.getTime() + 120_000) };
  assert.equal(await cache.get(code), null);
  await cache.put(link);
  assert.equal(ttl, 60_000);
  assert.deepEqual(await cache.get(code), { destination, expiresAt: link.expiresAt });
  assert.equal(await new RedisCache(client, 'outro', 60, 100, () => instant).get(code), null);
  instant = new Date(link.expiresAt.getTime() - 1);
  await cache.put(link);
  assert.equal(ttl, 1);
  assert.notEqual(await cache.get(code), null);
  instant = link.expiresAt;
  assert.equal(await cache.get(code), null);
  entries.clear();
  await cache.put(link);
  assert.equal(entries.size, 0);
  entries.set(`loja:${code}`, '{');
  assert.equal(await cache.get(code), null);
});

test('GET e SET sem resposta devolvem o controle mesmo após o envio ao socket', {timeout: 2000}, async () => {
  const never = new Promise<never>(() => {});
  const cache = new RedisCache({ get: () => never, set: () => never }, 'loja', 60, 25);
  assert.equal(await cache.get(code), null);
  await cache.put({ code, destination, expiresAt: new Date(Date.now() + 10_000) });
});

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
test('Redis real compartilha o cache, aplica TTL e dispensa fila offline', { timeout: 5000 }, async t => {
  const client = openRedis(redisUrl, 500);
  t.after(() => { if (client.isOpen) client.destroy(); });
  if (!client.isReady) await once(client, 'ready');
  const prefix = `teste:${randomUUID()}`;
  const cache = new RedisCache(client, prefix, 20, 500);
  const link = { code, destination, expiresAt: new Date(Date.now() + 10_000) };
  await cache.put(link);
  assert.deepEqual(await cache.get(code), { destination, expiresAt: link.expiresAt });
  const ttl = await client.pTTL(`${prefix}:${code}`);
  assert.ok(ttl > 0 && ttl <= 10_000);
  const afterExpiry = new RedisCache(client, prefix, 20, 500, () => link.expiresAt);
  assert.equal(await afterExpiry.get(code), null);
  await client.del(`${prefix}:${code}`);
  await client.close();
  assert.equal(await cache.get(code), null);
  await cache.put(link);
});
