// Pré-carregamento exclusivo dos ensaios do gerador. Cada processo usa um único fluxo.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const factor = Number(process.env.FATOR_LATENCIA);
const failures = process.env.FALHAS_AMOSTRA === '1';
const metrics = JSON.parse(process.env.COLETAS_METRICAS ?? '{}');
let elapsedMs = 0;
let writes = 0, reads = 0, creates = 0, gets = 0;
let short, destination;
performance.now = () => elapsedMs;

globalThis.fetch = async (url, options = {}) => {
  const { origin, pathname } = new URL(url);
  if (pathname === '/internal/metrics') {
    if (metrics[origin]) {
      const reading = metrics[origin].shift();
      if (reading === 'rede') throw new TypeError('Conexão interrompida');
      if (reading === 'json truncado') return new Response('{');
      if (typeof reading === 'number') return new Response(null, { status: reading });
      return Response.json(reading);
    }
    return Response.json({ processId: '9f519186-48aa-4ef9-a636-40cb041235aa', uptimeSeconds: elapsedMs / 1000, cacheHits: 0, operations: {
      cqlRead: { count: reads, errors: 0 }, cqlWrite: { count: writes, errors: 0 }
    } });
  }
  assert.equal(origin, new URL(process.env.API_ORIGIN).origin, 'requisição enviada à entrada configurada');
  assert.equal(options.redirect, 'manual');
  if (pathname === '/api/v1/encurtar' && options.method === 'POST') {
    if (process.env.REGISTRAR_CRIACAO) console.error('POST de criação recebido');
    elapsedMs += 2 * factor;
    creates++;
    if (failures && creates === 1) return new Response(null, { status: 503 });
    const nextDestination = JSON.parse(options.body).url;
    assert.equal(Buffer.byteLength(nextDestination), 100);
    assert.notEqual(nextDestination, destination);
    destination = nextDestination;
    const path = process.env.CAMINHO_CURTO || '/' + String(creates).padStart(7, '0');
    const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || origin).origin;
    const returned = process.env.LINK_RETORNADO || publicOrigin + path;
    short = new URL(returned);
    writes++;
    return Response.json({ short_url: returned }, { status: 201 });
  }
  let location = destination;
  if (pathname === short?.pathname && (options.method ?? 'GET') === 'GET') {
    elapsedMs += 4 * factor;
    gets++;
    if (failures && gets === 1) location = 'https://outro.example/';
  } else {
    assert.equal(pathname, '/api/v1/redirecionar');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).short_url, short.href);
    elapsedMs += 8 * factor;
  }
  reads++;
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
};
