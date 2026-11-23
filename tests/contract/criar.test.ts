import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { post, publicOrigin, start } from './http.js';

const path = '/api/v1/encurtar';
const suffix = '/cafe%2Fmoido?q=a%2Bb&cor=azul#detalhes';
const prefix = 'https://loja.example/';
const destination = prefix + 'a'.repeat(200 - prefix.length - suffix.length) + suffix;
const international = 'https://例え.テスト/東京%2F🧭?品=%2b#地図';
const internationalLocation = 'https://xn--r8jz45g.xn--zckzah/%E6%9D%B1%E4%BA%AC%2F%F0%9F%A7%AD?%E5%93%81=%2b#%E5%9C%B0%E5%9B%B3';

test('POST anônimo cria dois vínculos e conserva os 200 bytes do destino confirmado', async t => {
  const persisted = new Map<string, string>();
  const origin = await start(t, { create: async url => {
    const code = `k7Q2aZ${persisted.size}`;
    persisted.set(code, url);
    return code;
  } });
  assert.equal(Buffer.byteLength(destination), 200);
  const codes = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const response = await post(origin, path, JSON.stringify({ url: destination }));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.ok(body && typeof body === 'object' && 'short_url' in body && typeof body.short_url === 'string');
    assert.deepEqual(Object.keys(body), ['short_url']);
    const short = new URL(body.short_url);
    assert.equal(short.origin, publicOrigin);
    assert.match(short.pathname, /^\/[A-Za-z0-9]{7}$/);
    assert.equal(body.short_url, publicOrigin + short.pathname);
    const code = short.pathname.slice(1);
    assert.equal(persisted.get(code), destination);
    codes.add(code);
  }
  assert.equal(codes.size, 2);
});

test('POST conserva o Unicode literal de ideogramas, emoji e marcas combinantes', async t => {
  const writes: string[] = [];
  const origin = await start(t, { create: async url => { writes.push(url); return 'Abc1234'; } });
  const cases = [prefix + '東京', prefix + '🧭', prefix + 'cafe\u0301', international];
  for (const url of cases) {
    const response = await post(origin, path, JSON.stringify({url}));
    assert.equal(response.status, 201, url);
    assert.deepEqual(await response.json(), {short_url: publicOrigin + '/Abc1234'});
  }
  assert.deepEqual(writes, cases);
});

test('pedido inválido recebe 400 antes de tentar gravar', async t => {
  let writes = 0;
  const origin = await start(t, { create: async () => { writes++; return 'k7Q2aZ9'; } });
  const invalid = [
    '', 'ftp://loja.example', 'https://', '/relativa', prefix + '\r\nLocation: erro',
    prefix + '東\u0000京', prefix + '東\u001f京', prefix + '東\u007f京',
    prefix + '\ud800', prefix + '\udfff',
  ];
  for (const body of ['{', '{}', 'null', '[]', '{"url":42}', ...invalid.map(url => JSON.stringify({ url }))]) {
    const response = await post(origin, path, body);
    assert.equal(response.status, 400, body);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal(writes, 0);
});

test('falha na confirmação da escrita retorna 503 sem Location', async t => {
  let attempts = 0;
  const origin = await start(t, { create: async () => { attempts++; throw new Error('gravação sem confirmação'); } });
  const response = await post(origin, path, JSON.stringify({ url: destination }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(attempts, 1);
});

test('POST público conserva destinos repetidos e acentos em uma conexão Cassandra independente', async () => {
  const { withDatabase } = await import('../integration/database.js');
  const { administer } = await import('../../src/ids/recovery.js');
  const { FIRST_ID } = await import('../../src/ids/codec.js');
  const { startService } = await import('../../src/service.js');
  await withDatabase(async ({ client, config }) => {
    await administer(client, config, 'init', FIRST_ID + 100n);
    const { server, close } = await startService({ ...config, port: 0 });
    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const origin = `http://127.0.0.1:${address.port}`;
      const codes = new Set<string>();
      for (const url of [destination, destination, 'https://loja.example/café%2Fpedido?q=mão%2b#índice']) {
        const response = await post(origin, path, JSON.stringify({ url }));
        assert.equal(response.status, 201);
        const body = await response.json();
        assert.ok(body && typeof body === 'object' && 'short_url' in body && typeof body.short_url === 'string');
        const short = new URL(body.short_url);
        assert.equal(short.origin, config.origin);
        assert.match(short.pathname, /^\/[0-9A-Za-z]{7}$/);
        const code = short.pathname.slice(1);
        const row = (await client.execute('SELECT destination FROM links WHERE code = ?', [code], { prepare: true })).first();
        assert.equal(row?.destination, url);
        codes.add(code);
      }
      assert.equal(codes.size, 3);
    } finally {
      await close();
    }
  });
});


test('Unicode literal no Cassandra e no Redis conserva o mesmo Location com cache frio e quente', async () => {
  const { withDatabase } = await import('../integration/database.js');
  const { administer } = await import('../../src/ids/recovery.js');
  const { FIRST_ID } = await import('../../src/ids/codec.js');
  const { startService } = await import('../../src/service.js');
  const { openRedis } = await import('../../src/cache/redis.js');
  await withDatabase(async ({client, config}) => {
    await administer(client, config, 'init', FIRST_ID + 100n);
    const api = await startService({...config, port: 0});
    const redis = openRedis(config.redisUrl, 1000);
    let key: string | undefined;
    try {
      if (!redis.isReady) await once(redis, 'ready', {signal: AbortSignal.timeout(10000)});
      const address = api.server.address();
      assert.ok(address && typeof address === 'object');
      const origin = `http://127.0.0.1:${address.port}`;
      const created = await post(origin, path, JSON.stringify({url: international}));
      assert.equal(created.status, 201);
      const json = await created.json() as {short_url: string};
      const short = new URL(json.short_url);
      const code = short.pathname.slice(1);
      const row = (await client.execute('SELECT destination FROM links WHERE code = ?', [code], {prepare: true})).first();
      assert.equal(row?.destination, international);
      key = config.installation + ':' + code;
      async function metrics() {
        const res = await fetch(origin + '/internal/metrics');
        assert.equal(res.status, 200);
        return await res.json() as {cacheHits: number; operations: {cqlRead: {count: number}}};
      }
      for (const method of ['GET', 'POST']) {
        await redis.del(key);
        assert.equal(await redis.exists(key), 0);
        for (const warm of [false, true]) {
          const before = await metrics();
          const result = method === 'GET' ? await fetch(origin + short.pathname, {redirect: 'manual'}) :
            await post(origin, '/api/v1/redirecionar', JSON.stringify(json));
          assert.equal(result.status, 302);
          assert.equal(result.headers.get('cache-control'), 'no-store');
          assert.equal(result.headers.get('location'), internationalLocation);
          const after = await metrics();
          assert.equal(after.operations.cqlRead.count - before.operations.cqlRead.count, warm ? 0 : 1);
          assert.equal(after.cacheHits - before.cacheHits, warm ? 1 : 0);
          if (!warm) {
            const deadline = performance.now() + 2000;
            while (!(await redis.exists(key)) && performance.now() < deadline) await delay(10);
            const value = await redis.get(key);
            assert.ok(value);
            assert.equal(JSON.parse(value).destination, international);
          }
        }
      }
    } finally {
      try { if (key && redis.isReady) await redis.del(key); }
      finally { if (redis.isOpen) redis.destroy(); await api.close(); }
    }
  });
});
