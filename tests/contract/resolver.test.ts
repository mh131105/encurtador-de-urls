import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { request } from 'node:https';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import { createAppServer } from '../../src/http/server.js';
import { RedisCache } from '../../src/cache/redis.js';
import { creator } from '../../src/links/create.js';
import { resolver } from '../../src/links/resolve.js';
import type { Link } from '../../src/links/link.js';
import { post, publicOrigin, start } from './http.js';

const path = '/api/v1/redirecionar';
const code = 'k7Q2aZ9';
const destination = 'https://loja.example/a%2Fb?q=Caf%C3%A9&x=%2b#cap%C3%ADtulo';

async function both(origin: string, target: string) {
  return Promise.all([
    fetch(`${origin}/${target}`, { redirect: 'manual' }),
    post(origin, path, JSON.stringify({ short_url: `${publicOrigin}/${target}` })),
  ]);
}

// Os parsers HTTP do cliente e do servidor trocam bytes sem abrir uma porta ou acessar a loja.
function exchange(server: Server, url: string, json?: object): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      defaultPort: 443,
      method: json ? 'POST' : 'GET',
      headers: json ? { 'Content-Type': 'application/json' } : {},
      createConnection() {
        const [client, peer] = duplexPair();
        server.emit('connection', peer);
        return client;
      },
    }, resolve);
    req.on('error', reject);
    req.end(JSON.stringify(json));
  });
}

test('acentos literais chegam ao destino em UTF-8 em vínculos novos e antigos', async () => {
  const literal = 'https://loja.example/café%2Fpedido?q=mão%2b#índice';
  const escaped = 'https://loja.example/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice';
  const records = new Map([['Antigo1', literal], ['Escape2', destination]]);
  const api = createAppServer({
    origin: publicOrigin,
    create: creator(async () => code, async link => { records.set(link.code, link.destination); }),
    resolve: async key => records.get(key) ?? null,
  });
  const shop = createServer((req, res) => res.end(req.url));
  const created = await exchange(api, publicOrigin + '/api/v1/encurtar', { url: literal });
  assert.equal(created.statusCode, 201);
  const shortUrl = publicOrigin + '/' + code;
  assert.deepEqual(JSON.parse(await text(created)), { short_url: shortUrl });

  for (const [short, expected] of [
    [shortUrl, escaped], [publicOrigin + '/Antigo1', escaped], [publicOrigin + '/Escape2', destination],
  ]) {
    for (const response of [
      await exchange(api, short),
      await exchange(api, publicOrigin + path, { short_url: short }),
    ]) {
      response.resume();
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.ok(response.headers.location);
      // O cliente HTTP do Node expõe os bytes do cabeçalho como caracteres Latin-1.
      const bytes = Buffer.from(response.headers.location, 'latin1');
      const target = new URL(bytes.toString('utf8'));
      assert.equal(target.href, expected);
      assert.deepEqual(bytes, Buffer.from(expected, 'ascii'));
      const landed = await exchange(shop, target.href);
      assert.equal(landed.statusCode, 200);
      const { pathname, search } = new URL(expected);
      assert.equal(await text(landed), pathname + search);
    }
  }
  assert.equal(records.get(code), literal);
  assert.equal(records.get('Antigo1'), literal);
});

test('GET e POST resolvem o mesmo destino literal até o último milissegundo de validade', async t => {
  const end = Date.parse('2040-03-01T09:30:00.000Z');
  let now = end - 1;
  const lookedUp: string[] = [];
  const origin = await start(t, { resolve: async key => {
    lookedUp.push(key);
    return key === code && now < end ? destination : null;
  } });
  for (const response of await both(origin, code)) {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), destination);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const target of ['abC1234', 'K7Q2aZ9', code]) {
    if (target === code) now = end;
    for (const response of await both(origin, target)) {
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  }
  assert.deepEqual(lookedUp, [code, code, 'abC1234', 'abC1234', 'K7Q2aZ9', 'K7Q2aZ9', code, code]);
});

test('acentos em vínculos novos e legados preservam o destino efetivo, escapes e fragmento', async t => {
  const received: string[] = [];
  const landing = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    res.end('destino');
  });
  landing.listen(0, '127.0.0.1');
  await once(landing, 'listening');
  t.after(() => { landing.closeAllConnections(); landing.close(); });
  const address = landing.address();
  assert.ok(address && typeof address === 'object');
  const local = `http://127.0.0.1:${address.port}`;
  const suffix = '/café%2Fpedido?q=mão%2b#índice';
  const uriSuffix = '/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice';
  const ascii = 'HTTPS://LOJA.Example:443/a/../%2Fb?x=%2b#A%2fB';
  const now = () => new Date('2026-01-01T00:00:00Z');
  const rows = new Map<string, Link>();
  const values = new Map<string, string>();
  let reads = 0, hits = 0;
  const cache = new RedisCache({
    get: async key => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
  }, 'teste', 60, 100, now);
  const origin = await start(t, {
    create: creator(async () => String(rows.size + 1).padStart(7, '0'), async link => { rows.set(link.code, link); }, now),
    resolve: resolver(cache, async key => { reads++; return rows.get(key) ?? null; }, now, () => { hits++; }),
  });
  for (const [literal, wire, legacy] of [
    [local + suffix, local + uriSuffix, false],
    [local + suffix, local + uriSuffix, true],
    ['HTTPS://usuário:clé@café.example:443/a/../b?x=%2b#é',
      'HTTPS://usu%C3%A1rio:cl%C3%A9@xn--caf-dma.example:443/a/../b?x=%2b#%C3%A9', false],
    ['https://例え.テスト/東京%2F🧭?品=%2b#地図',
      'https://xn--r8jz45g.xn--zckzah/%E6%9D%B1%E4%BA%AC%2F%F0%9F%A7%AD?%E5%93%81=%2b#%E5%9C%B0%E5%9B%B3', false],
    ['https://例%65.テスト/東京%2F?q=%2b',
      'https://%E4%BE%8B%65.%E3%83%86%E3%82%B9%E3%83%88/%E6%9D%B1%E4%BA%AC%2F?q=%2b', false],
    [ascii, ascii, false],
  ] as const) {
    let target: string;
    if (legacy) {
      target = String(rows.size + 1).padStart(7, '0');
      rows.set(target, {code: target, destination: literal, createdAt: new Date('2025-01-01'), expiresAt: new Date('2035-01-01')});
    } else {
      const created = await post(origin, '/api/v1/encurtar', JSON.stringify({ url: literal }));
      assert.equal(created.status, 201);
      const body = await created.json();
      assert.ok(body && typeof body === 'object' && 'short_url' in body && typeof body.short_url === 'string');
      target = new URL(body.short_url).pathname.slice(1);
    }
    for (const method of ['GET', 'POST']) {
      const entry = method === 'GET' ? `${origin}/${target}` : origin + path;
      const options = method === 'GET' ? {} : {method, headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({short_url: `${publicOrigin}/${target}`})};
      values.clear();
      for (const warm of [false, true]) {
        const before = {reads, hits};
        const response = await fetch(entry, {...options, redirect: 'manual'});
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('location'), wire);
        assert.equal(new URL(response.headers.get('location')!).href, new URL(literal).href);
        assert.equal(reads - before.reads, warm ? 0 : 1);
        assert.equal(hits - before.hits, warm ? 1 : 0);
        assert.equal(rows.get(target)?.destination, literal);
        assert.equal(JSON.parse(values.get(`teste:${target}`)!).destination, literal);
      }
      if (literal.startsWith(local + '/')) {
        const followed = await fetch(entry, options);
        assert.equal(followed.redirected, true);
        assert.equal(await followed.text(), 'destino');
      }
    }
  }
  const targetPath = uriSuffix.split('#')[0];
  assert.deepEqual(received, Array(4).fill(`GET ${targetPath}`));
});

test('caminhos inválidos recebem 404 e POST inválido recebe 400 sem consultar o banco', async t => {
  let reads = 0;
  const origin = await start(t, { resolve: async () => { reads++; return destination; } });
  for (const invalid of ['/abc', '/a23_456', '/12345678', '/pasta/codigo']) {
    const response = await fetch(origin + invalid, { redirect: 'manual' });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const body of ['{', '{}', 'null', '{"short_url":42}', ...[`https://fora.example/${code}`, `${publicOrigin}/abc`, `${publicOrigin}/${code}#frag`, `${publicOrigin}/${code}?consulta=1`].map(short_url => JSON.stringify({ short_url }))]) {
    const response = await post(origin, path, body);
    assert.equal(response.status, 400, body);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal(reads, 0);
});

test('cache sem resultado válido e falha de leitura devolvem 503 sem Location pelas duas rotas', async t => {
  const origin = await start(t, { resolve: async () => { throw new Error('fonte indisponível'); } });
  for (const response of await both(origin, code)) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
  }
});

test('vínculo criado em 2030 e em 29/02 vence no instante civil com cache aquecido ou vazio', async t => {
  const { creator } = await import('../../src/links/create.js');
  const { resolver } = await import('../../src/links/resolve.js');
  for (const [created, end] of [
    ['2030-10-05T06:07:08.169Z', '2040-10-05T06:07:08.169Z'],
    ['2032-02-29T12:45:00.003Z', '2042-02-28T12:45:00.003Z'],
  ]) {
    let instant = new Date(created);
    let stored: Link | null = null;
    let cached: Link | null = null;
    let reads = 0;
    const now = () => instant;
    const create = creator(async () => code, async link => { stored = link; }, now);
    const resolve = resolver({ get: async () => cached, put: async link => { cached = link; } }, async () => { reads++; return stored; }, now);
    const origin = await start(t, { create, resolve });
    const response = await post(origin, '/api/v1/encurtar', JSON.stringify({ url: destination }));
    assert.equal(response.status, 201);
    instant = new Date(Date.parse(end) - 1);
    for (const warm of [false, true]) {
      if (!warm) cached = null;
      for (const result of await both(origin, code)) {
        assert.equal(result.status, 302);
        assert.equal(result.headers.get('location'), destination);
        assert.equal(result.headers.get('cache-control'), 'no-store');
      }
    }
    assert.ok(reads > 0 && reads < 4);
    instant = new Date(end);
    for (const warm of [true, false]) {
      if (!warm) cached = null;
      for (const result of await both(origin, code)) {
        assert.equal(result.status, 404);
        assert.equal(result.headers.get('location'), null);
        assert.equal(result.headers.get('cache-control'), 'no-store');
      }
    }
  }
});

test('a leitura persistente confirmada responde antes do preenchimento do Redis', async t => {
  const { RedisCache } = await import('../../src/cache/redis.js');
  const { resolver } = await import('../../src/links/resolve.js');
  let gets = 0, sets = 0, reads = 0;
  let available = true;
  const cache = new RedisCache({
    get() { gets++; return new Promise<string | null>(() => {}); },
    set() { sets++; return new Promise<void>(() => {}); }
  }, 'teste', 60, 100);
  const link: Link = { code, destination, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  const origin = await start(t, {
    requestTimeoutMs: 170,
    resolve: resolver(cache, async () => {
      reads++;
      if (!available) throw new Error('Cassandra indisponível');
      return link;
    })
  });
  for (const response of await both(origin, code)) {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), destination);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(sets, 2);
  available = false;
  for (const response of await both(origin, code)) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal(gets, 4);
  assert.equal(reads, 4);
  assert.equal(sets, 2);
});

test('destino inválido no Redis consulta o Cassandra em GET e POST', async t => {
  const { RedisCache } = await import('../../src/cache/redis.js');
  const { resolver } = await import('../../src/links/resolve.js');
  const link: Link = { code, destination, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  let cachedDestination = '', available = true, reads = 0, hits = 0;
  const cache = new RedisCache({
    get: async () => JSON.stringify({ destination: cachedDestination, expiresAt: link.expiresAt.getTime() }),
    set: async () => {}
  }, 'teste', 60, 100);
  const origin = await start(t, { resolve: resolver(cache, async target => {
    assert.equal(target, code);
    reads++;
    if (!available) throw new Error('Cassandra indisponível');
    return link;
  }, undefined, () => { hits++; }) });
  for (cachedDestination of ['', '/sem-origem', 'ftp://loja.example/item']) {
    for (available of [true, false]) {
      const before = reads;
      for (const response of await both(origin, code)) {
        assert.equal(response.status, available ? 302 : 503);
        assert.equal(response.headers.get('location'), available ? destination : null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      assert.equal(reads - before, 2);
      assert.equal(hits, 0);
    }
  }
});

test('um GET do Redis pendente reserva tempo para as duas rotas consultarem o Cassandra', async t => {
  const { RedisCache } = await import('../../src/cache/redis.js');
  const { resolver } = await import('../../src/links/resolve.js');
  const link: Link = { code, destination, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  const pending = new Promise<never>(() => {});
  let warm = false, available = true, reads = 0, hits = 0;
  const cache = new RedisCache({
    get: () => warm ? Promise.resolve(JSON.stringify({ destination, expiresAt: link.expiresAt.getTime() })) : pending,
    set: () => pending
  }, 'teste', 60, 100);
  const origin = await start(t, {
    requestTimeoutMs: 40,
    resolve: resolver(cache, async () => {
      reads++;
      if (!available) throw new Error('Cassandra indisponível');
      return link;
    }, undefined, () => { hits++; })
  });
  const requests = [
    () => fetch(origin + '/' + code, { redirect: 'manual' }),
    () => post(origin, path, JSON.stringify({ short_url: publicOrigin + '/' + code }))
  ];
  for (available of [true, false]) {
    for (const request of requests) {
      const before = reads;
      const result = await request();
      assert.equal(result.status, available ? 302 : 503);
      assert.equal(result.headers.get('location'), available ? destination : null);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.equal(reads - before, 1);
    }
  }
  warm = true;
  for (const result of await both(origin, code)) {
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('location'), destination);
  }
  assert.equal(hits, 2);
  assert.equal(reads, 4);
});

test('a leitura do corpo do POST consome parte do orçamento antes de consultar o Redis', async t => {
  const { request } = await import('node:http');
  const { setTimeout: sleep } = await import('node:timers/promises');
  const { RedisCache } = await import('../../src/cache/redis.js');
  const { resolver } = await import('../../src/links/resolve.js');
  const pending = new Promise<never>(() => {});
  const cache = new RedisCache({ get: () => pending, set: async () => {} }, 'teste', 60, 300);
  const link: Link = { code, destination, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) };
  let reads = 0;
  const origin = await start(t, { requestTimeoutMs: 300, resolve: resolver(cache, async () => { reads++; return link; }) });
  const body = JSON.stringify({short_url: publicOrigin + '/' + code});
  const upload = request(origin + path, {
    method: 'POST', agent: false,
    headers: { Expect: '100-continue', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  const accepted = once(upload, 'continue');
  const response = once(upload, 'response');
  upload.flushHeaders();
  try {
    await accepted;
    upload.write(body.slice(0, -1));
    await sleep(180);
    upload.end(body.slice(-1));
    const [result] = await response;
    result.resume();
    assert.equal(result.statusCode, 302);
    assert.equal(result.headers.location, destination);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(reads, 1);
  } finally { upload.destroy(); }
});
