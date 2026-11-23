import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { administer } from '../../src/ids/recovery.js';
import { FIRST_ID } from '../../src/ids/codec.js';
import { startService } from '../../src/service.js';
import { withDatabase } from './database.js';
import { post } from '../contract/http.js';

test('mede GET, POST e erros no armazenamento, mantendo a leitura em cache durante falha no banco', async () => {
  await withDatabase(async ({ client, config }) => {
    await administer(client, config, 'init', FIRST_ID + 10000n);
    const { server, close } = await startService({ ...config, port: 0, redisUrl: process.env.TEST_REDIS_URL ?? config.redisUrl });
    try {
      const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
      const url = 'https://loja.example/r%2f?q=a%2Bb#detalhes';
      const create = () => post(base, '/api/v1/encurtar', JSON.stringify({ url }));
      const res = await create();
      assert.equal(res.status, 201);
      const value = await res.json() as { short_url: string };
      const path = new URL(value.short_url).pathname;
      const get = (code: string) => fetch(base + code, { redirect: 'manual' });
      assert.equal((await get(path)).headers.get('location'), url);
      await client.execute('DROP TABLE links'); // keyspace exclusivo deste teste
      assert.equal((await get(path)).headers.get('location'), url);
      for (const failed of [await create(), await get('/zzzzzzz')]) {
        assert.equal(failed.status, 503);
        assert.equal(failed.headers.get('location'), null);
      }
      const serialized = await (await fetch(base + '/internal/metrics')).text();
      const m = JSON.parse(serialized);
      assert.equal(m.operations.create.count, 2);
      assert.equal(m.operations.resolve.count, 3);
      assert.equal(m.operations.cqlRead.count, 2);
      assert.equal(m.operations.cqlWrite.count, 2);
      assert.equal(m.operations.cqlRead.errors, 1);
      assert.equal(m.operations.cqlWrite.errors, 1);
      assert.equal(m.cacheHits, 1);
      assert.ok(m.memoryBytes.rss > 0 && +m.localIds > 0);
      assert.ok(m.eventLoopP99Ms >= 0);
      for (const needle of [url, path.slice(1), Buffer.from(config.key).toString('hex')]) assert.ok(!serialized.includes(needle));
    } finally { await close(); }
  });
});
