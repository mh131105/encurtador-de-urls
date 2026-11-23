import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openRedis } from '../../src/cache/redis.js';
import { createIssuer } from '../../src/ids/allocator.js';
import { createCodec, FIRST_ID } from '../../src/ids/codec.js';
import { administer } from '../../src/ids/recovery.js';
import { creator } from '../../src/links/create.js';
import { startService } from '../../src/service.js';
import { reserveBlock, type Block } from '../../src/storage/allocator.js';
import { writeLink } from '../../src/storage/write.js';
import { post, start } from '../contract/http.js';
import { withDatabase } from './database.js';

test('duas réplicas, interrupção, reserva ambígua e cache frio mantêm os destinos confirmados', async t => {
  await withDatabase(async ({ client, config, newClient }) => {
    config.blockSize = 5n;
    config.installation = config.keyspace;
    await administer(client, config, 'init', FIRST_ID + 100n);
    const replicas: Awaited<ReturnType<typeof startService>>[] = [];
    async function launch() {
      const service = await startService({ ...config, port: 0 });
      replicas.push(service);
      const address = service.server.address();
      assert.ok(address && typeof address === 'object');
      return `http://127.0.0.1:${address.port}`;
    }
    const redis = openRedis(config.redisUrl, 1000);
    const confirmed = new Map<string, string>();
    async function make(origin: string, index: number) {
      const destination = `https://loja.example/kit%2F${index}?busca=a%2Bb#se%C3%A7%C3%A3o-${index}`;
      const res = await post(origin, '/api/v1/encurtar', JSON.stringify({ url: destination }));
      assert.equal(res.status, 201);
      const data = await res.json();
      assert.ok(data && typeof data === 'object' && 'short_url' in data && typeof data.short_url === 'string');
      assert.equal(new URL(data.short_url).origin, config.origin);
      assert.match(new URL(data.short_url).pathname, /^\/[A-Za-z0-9]{7}$/);
      assert.equal(confirmed.has(data.short_url), false);
      confirmed.set(data.short_url, destination);
      return data.short_url;
    }
    async function check(origin: string, shortUrl: string) {
      const responses = await Promise.all([
        fetch(origin + new URL(shortUrl).pathname, { redirect: 'manual' }),
        post(origin, '/api/v1/redirecionar', JSON.stringify({ short_url: shortUrl })),
      ]);
      for (const response of responses) {
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), confirmed.get(shortUrl));
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    const key = (shortUrl: string) => `${config.installation}:${new URL(shortUrl).pathname.slice(1)}`;
    try {
      if (!redis.isReady) await once(redis, 'ready');
      const [a, b] = await Promise.all([launch(), launch()]);
      const first = await make(a, 0);
      assert.equal(await redis.exists(key(first)), 0);
      await check(b, first);
      // O redirecionamento pode terminar antes do SET assíncrono chegar ao Redis.
      const cacheDeadline = performance.now() + 1000;
      while (!(await redis.exists(key(first))) && performance.now() < cacheDeadline) await delay(10);
      assert.equal(await redis.exists(key(first)), 1);
      await Promise.all(Array.from({ length: 12 }, (_, i) => make(i % 2 ? a : b, i + 1)));
      // A réplica deixa de atender; seu saldo local é abandonado.
      const firstReplica = replicas.find(r => {
        const address = r.server.address();
        return address && typeof address === 'object' && a.endsWith(`:${address.port}`);
      });
      assert.ok(firstReplica);
      await firstReplica.close();
      const recovered = await launch();
      const lost: Block[] = [];
      const connection = newClient();
      const issuer = createIssuer(connection, config, async marker => {
        const block = await reserveBlock(connection, config.consistency, config.blockSize, marker);
        lost.push(block);
        throw new Error('Reserva aplicada sem resposta ao emissor');
      });
      const unstable = await start(t, { create: creator(issuer.nextCode, link => writeLink(connection, config.consistency, link)) });
      const failed = await post(unstable, '/api/v1/encurtar', JSON.stringify({ url: 'https://loja.example/ambiguo' }));
      assert.equal(failed.status, 503);
      assert.equal(failed.headers.get('location'), null);
      assert.equal(lost.length, 1);
      await Promise.all(Array.from({ length: 12 }, (_, i) => make(i % 2 ? b : recovered, i + 13)));
      assert.equal(confirmed.size, 25);
      const codec = createCodec(config.key, config.tweak);
      const keys = Array.from(confirmed.keys(), key);
      await redis.del(keys);
      assert.equal(await redis.exists(keys), 0);
      for (const short of confirmed.keys()) {
        const id = codec.decode(new URL(short).pathname.slice(1));
        assert.ok(id < lost[0].start || id >= lost[0].end);
        await check(recovered, short);
      }
    } finally {
      try {
        await Promise.all(replicas.map(r => r.close()));
        if (redis.isReady && confirmed.size) await redis.del(Array.from(confirmed.keys(), key));
      } finally {
        if (redis.isOpen) redis.destroy();
      }
    }
  });
});
