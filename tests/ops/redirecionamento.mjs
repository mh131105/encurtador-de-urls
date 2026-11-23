// O cliente lê o Location literal, inclusive no limite do corpo JSON da criação.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { request as secureRequest } from 'node:https';

const entry = new URL(process.argv[2]);
const send = entry.protocol === 'https:' ? secureRequest : request;
function http(path, body) {
  return new Promise((resolve, reject) => {
    const req = send(entry, {
      path, maxHeaderSize: 4 * 1024 * 1024,
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Tempo de resposta excedido')));
    req.once('error', reject);
    req.end(body);
  });
}

const prefix = 'https://loja.example/a%2Fb?pedido=';
const suffix = '&cor=caf%C3%A9#se%C3%A7%C3%A3o';
const bodyLimit = 1024 * 1024;
const overhead = Buffer.byteLength(JSON.stringify({ url: '' }));
for (const [bytes, fill] of [[12 * 1024, 'a'], [bodyLimit - overhead, 'a'], [bodyLimit - overhead, 'é']]) {
  const available = bytes - prefix.length - suffix.length;
  const width = Buffer.byteLength(fill);
  const padding = fill.repeat(Math.floor(available / width)) + 'a'.repeat(available % width);
  const url = prefix + padding + suffix;
  const location = url.replaceAll('é', '%C3%A9');
  const body = JSON.stringify({ url });
  assert.equal(Buffer.byteLength(body), bytes + overhead);
  const created = await http('/api/v1/encurtar', body);
  assert.equal(created.status, 201);
  const { short_url } = JSON.parse(created.body);
  for (const response of [
    await http(new URL(short_url).pathname),
    await http('/api/v1/redirecionar', JSON.stringify({ short_url })),
  ]) {
    assert.equal(response.status, 302, `resolução do destino de ${bytes} bytes`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.headers.location === location, `Location integral de ${location.length} bytes`);
  }
  if (bytes === bodyLimit - overhead && fill === 'a') {
    // Espaço após o objeto é válido em JSON. O código e o destino continuam os mesmos.
    const shortBody = JSON.stringify({ short_url });
    const exact = shortBody + ' '.repeat(bodyLimit - Buffer.byteLength(shortBody));
    assert.equal(Buffer.byteLength(exact), bodyLimit);
    const resolved = await http('/api/v1/redirecionar', exact);
    assert.equal(resolved.status, 302);
    assert.equal(resolved.headers['cache-control'], 'no-store');
    assert.ok(resolved.headers.location === url);
    for (const [path, json] of [['/api/v1/encurtar', body], ['/api/v1/redirecionar', exact]]) {
      const invalid = await http(path, json + ' ');
      assert.equal(invalid.status, 400, path);
      assert.equal(invalid.headers.location, undefined, path);
      assert.equal(invalid.headers['cache-control'], 'no-store', path);
    }
    console.log('OK · os dois POSTs aceitam 1 MiB e devolvem 400 um byte acima');
  }
  console.log(`OK · destino de ${bytes} bytes, Location de ${location.length} bytes nas duas rotas`);
}
const root = await http('/');
assert.equal(root.status, 200);
assert.match(root.body, /<html\b/i);
const asset = /(?:src|href)="(\/assets\/[^"?#]+)"/.exec(root.body)?.[1];
assert.ok(asset, 'asset referenciado no HTML do build');
const assetName = asset.slice('/assets/'.length);
for (const path of [asset, asset + '?v=1']) assert.equal((await http(path)).status, 200, path);
// Passe o caminho literal ao HTTP. A API URL do cliente eliminaria os segmentos de ponto.
for (const path of ['//', '/' + asset, '/assets//' + assetName, '/assets/./' + assetName,
  '/assets/outro/../' + assetName, '/%61ssets/' + assetName, '/falso/..' + asset + '?v=1']) {
  const invalid = await http(path);
  assert.equal(invalid.status, 404, path);
  assert.equal(invalid.headers['cache-control'], 'no-store', path);
  assert.equal(invalid.headers.location, undefined, path);
}
console.log('OK · raiz e asset publicados, 404 sem Location e com no-store nos caminhos inválidos');
