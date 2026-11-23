// Mede a drenagem na conexão já aceita pela API. O NGINX pode armazenar um corpo incompleto.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const [entry, api, ...stop] = process.argv.slice(2);
assert.ok(entry && api && stop.length, 'Uso: node parada.mjs ORIGEM_PUBLICA ORIGEM_API comando-de-parada ...');
const destination = 'https://loja.example/caf%C3%A9%2F?q=a%2Bb#detalhes';
const saved = await fetch(entry + '/api/v1/encurtar', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: destination }),
});
assert.equal(saved.status, 201);
const body = JSON.stringify(await saved.json());
const pending = request(api + '/api/v1/redirecionar', {
  method: 'POST', agent: false,
  headers: { Expect: '100-continue', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
});
const accepted = once(pending, 'continue');
const response = once(pending, 'response').then(async ([res]) => {
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, destination);
  assert.equal(res.headers['cache-control'], 'no-store');
  res.resume();
  await once(res, 'end');
});
pending.flushHeaders();
await accepted;
const processStop = spawn(stop[0], stop.slice(1), { stdio: 'inherit' });
const stopped = once(processStop, 'exit').then(([code]) => assert.equal(code, 0));
async function completeUpload() {
  await sleep(11000);
  pending.end(body);
}
try {
  await Promise.all([response, stopped, completeUpload()]);
  console.log('OK · POST concluído com 302 após 11 s de drenagem da API');
} finally { pending.destroy(); }
