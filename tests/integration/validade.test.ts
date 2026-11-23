import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { openRedis, RedisCache } from '../../src/cache/redis.js';
import { createIssuer } from '../../src/ids/allocator.js';
import { FIRST_ID } from '../../src/ids/codec.js';
import { administer } from '../../src/ids/recovery.js';
import { creator } from '../../src/links/create.js';
import { resolver } from '../../src/links/resolve.js';
import { readLink } from '../../src/storage/read.js';
import { writeLink } from '../../src/storage/write.js';
import { post, start } from '../contract/http.js';
import { withDatabase } from './database.js';

test('GET e POST aplicam o vencimento civil com Cassandra e Redis reais, vazio ou aquecido', async t => {
  await withDatabase(async ({ client, config }) => {
    let current: Date;
    let reads = 0;
    const now = () => current;
    const redis = openRedis(config.redisUrl, 1000);
    const prefix = config.keyspace;
    const cache = new RedisCache(redis, prefix, 3600, 1000, now);
    const issuer = createIssuer(client, config);
    const destination = 'https://example.net/caf%C3%A9?q=a%2Bb#se%C3%A7%C3%A3o';
    try {
      if (!redis.isReady) await once(redis, 'ready', {signal: AbortSignal.timeout(10000)});
      await administer(client, config, 'init', FIRST_ID + 4096n);
      const origin = await start(t, {
        origin: config.origin,
        create: creator(issuer.nextCode, link => writeLink(client, config.consistency, link, now()), now),
        resolve: resolver(cache, code => {
          reads++;
          return readLink(client, config.consistency, code);
        }, now)
      });
      for (const [created, expected] of [
        ['2030-10-05T06:07:08.169Z', '2040-10-05T06:07:08.169Z'],
        ['2032-02-29T12:45:00.003Z', '2042-02-28T12:45:00.003Z']
      ]) {
        current = new Date(created);
        const response = await post(origin, '/api/v1/encurtar', JSON.stringify({url:destination}));
        assert.equal(response.status, 201);
        const short = new URL(((await response.json()) as {short_url:string}).short_url);
        const code = short.pathname.slice(1);
        const key = prefix + ':' + code;
        const link = await readLink(client, config.consistency, code);
        assert.ok(link);
        assert.equal(link.createdAt.toISOString(), created);
        assert.equal(link.expiresAt.toISOString(), expected);
        try {
          for (const warm of [true, false]) {
            for (const delta of [-1, 0]) {
              for (const method of ['GET','POST']) {
                current = new Date(created);
                if (warm) await cache.put(link);
                else await redis.del(key);
                assert.equal(await redis.exists(key), Number(warm));
                current = new Date(Date.parse(expected) + delta);
                const before = reads;
                const result = method === 'GET' ? await fetch(origin + short.pathname, {redirect:'manual'}) :
                  await post(origin, '/api/v1/redirecionar', JSON.stringify({short_url:short.href}));
                assert.equal(result.status, delta < 0 ? 302 : 404);
                assert.equal(result.headers.get('location'), delta < 0 ? destination : null);
                assert.equal(result.headers.get('cache-control'), 'no-store');
                assert.equal(reads - before, warm && delta < 0 ? 0 : 1);
              }
            }
          }
        } finally { await redis.del(key); }
      }
    } finally { if (redis.isOpen) redis.destroy(); }
  });
});
