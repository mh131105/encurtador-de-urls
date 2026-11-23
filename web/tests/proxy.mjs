import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { request as requestHttps } from 'node:https';
import { text } from 'node:stream/consumers';

const [vite, api] = process.argv.slice(2).map(value => new URL(value).origin);
assert.ok(vite && api && vite !== api, 'Informe a origem do Vite e a origem direta da API de teste');

async function send(origin, path, json) {
  const url = new URL(path, origin);
  const transport = url.protocol === 'https:' ? requestHttps : request;
  // O cliente lê Location literalmente e não segue o 302.
  const req = transport(url, {
    method: json === undefined ? 'GET' : 'POST',
    headers: json === undefined ? {} : { 'Content-Type': 'application/json' },
    maxHeaderSize: 4 * 1024 * 1024,
    signal: AbortSignal.timeout(30000),
  });
  const received = once(req, 'response');
  req.end(json);
  const [res] = await received;
  return { status: res.statusCode, headers: res.headers, body: await text(res) };
}

const bodyLimit = 1024 * 1024;
const maxBytes = bodyLimit - Buffer.byteLength(JSON.stringify({ url: '' }));
const prefix = 'https://loja.example/a%2Fb?pedido=';
const suffix = '&cor=caf%C3%A9#se%C3%A7%C3%A3o';
for (const path of ['/', '/@vite/client', '/src/main.tsx', '/tests/formulario.html']) {
  assert.equal((await send(vite, path)).status, 200, path);
}
const links = [];
for (const [bytes, fill] of [[12000, 'a'], [20480, 'a'], [maxBytes, 'a'], [maxBytes, 'é']]) {
  const space = bytes - prefix.length - suffix.length;
  const width = Buffer.byteLength(fill);
  const url = prefix + fill.repeat(Math.floor(space / width)) + 'a'.repeat(space % width) + suffix;
  const json = JSON.stringify({ url });
  const expected = url.replaceAll('é', '%C3%A9');
  assert.equal(Buffer.byteLength(url), bytes);
  const created = await send(vite, '/api/v1/encurtar', json);
  assert.equal(created.status, 201);
  const { short_url } = JSON.parse(created.body);
  const short = new URL(short_url);
  assert.equal(short.origin, vite, 'PUBLIC_ORIGIN da API deve apontar para o Vite');
  assert.match(short.pathname, /^\/[A-Za-z0-9]{7}$/);
  assert.equal(short_url, vite + short.pathname);
  links.push({ short_url, path: short.pathname, expected, bytes });
  if (bytes === maxBytes && fill === 'a') {
    assert.equal(Buffer.byteLength(json), bodyLimit);
    const excess = await send(vite, '/api/v1/encurtar', json + ' ');
    assert.equal(excess.status, 400, 'um byte acima do limite de criação');
    assert.equal(excess.headers.location, undefined);
    assert.equal(excess.headers['cache-control'], 'no-store');
  }
}

// Cada vínculo é resolvido enquanto os pedidos dos outros vínculos estão em voo.
assert.equal(new Set(links.map(link => link.short_url)).size, links.length);
await Promise.all(links.map(async ({ short_url, path, expected, bytes }) => {
  for (const origin of [api, vite]) {
    for (const [route, body] of [[path], ['/api/v1/redirecionar', JSON.stringify({ short_url })]]) {
      const res = await send(origin, route, body);
      const context = `${origin}${route} para destino de ${bytes} bytes`;
      assert.equal(res.status, 302, context);
      assert.equal(res.headers['cache-control'], 'no-store', context);
      assert.ok(res.headers.location === expected, `Location divergente em ${context}`);
    }
  }
  console.log(`OK · ${bytes} bytes de destino, ${expected.length} em Location, GET e POST na API e no Vite`);
}));
