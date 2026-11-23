// As entradas NGINX usam APIs de teste que encerram a conexão após receber o corpo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'enc-proxy-post-'));
const compose = (...args) => execFileSync('docker', [
  'compose', '-p', basename(dir).toLowerCase(), '-f', join(dir, 'compose.yaml'), ...args,
], { encoding: 'utf8', env: { ...process.env, HA_CONFIG: resolve('deploy/ha/nginx.conf') } });

try {
  await writeFile(join(dir, 'fixture.cjs'), `
    require('node:http').createServer((req, res) => {
      if (req.method !== 'POST') return res.end();
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        console.log(req.method, req.url, Buffer.concat(chunks).toString());
        res.destroy();
      });
    }).listen(3000);
  `);
  await writeFile(join(dir, 'compose.yaml'), `
x-api: &api
  image: \${API_IMAGE:-encurtador-api:0.1.0}
  command: [node, /fixture.cjs]
  volumes: ["./fixture.cjs:/fixture.cjs:ro"]
  healthcheck:
    test: [CMD, node, -e, "fetch('http://127.0.0.1:3000').then(r => process.exit(r.ok ? 0 : 1))"]
    interval: 1s
    timeout: 2s
    retries: 30
services:
  api-a:
    <<: *api
    networks:
      default:
        aliases: [api]
  api-b: *api
  demo:
    image: \${NGINX_IMAGE:-encurtador-nginx:0.1.1}
    ports: ["127.0.0.1::80"]
  ha:
    image: \${NGINX_IMAGE:-encurtador-nginx:0.1.1}
    ports: ["127.0.0.1::80"]
    volumes: ["\${HA_CONFIG}:/etc/nginx/nginx.conf:ro"]
`);
  compose('up', '-d', '--wait', '--wait-timeout', '45');
  for (const profile of ['demo', 'ha']) {
    const addr = compose('port', profile, '80').trim();
    const body = JSON.stringify({ url: `https://loja.example/confirmar?perfil=${profile}#destino` });
    const response = await fetch(`http://${addr}/api/v1/encurtar`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body,
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const logs = compose('logs', '--no-color', '--no-log-prefix', 'api-a', 'api-b');
    const received = logs.split('\n').filter(line => line === `POST /api/v1/encurtar ${body}`);
    assert.equal(received.length, 1, `${profile}: POST recebido pelas APIs de teste`);
    console.log(`OK · ${profile}: POST recebido uma vez, resposta 503/no-store sem Location`);
  }
} finally {
  try { compose('down'); } finally { await rm(dir, { recursive: true, force: true }); }
}
