import assert from 'node:assert/strict';

const [origin, direct, demo, ha] = process.argv.slice(2);
if (!origin || !direct || !demo || !ha) throw new Error('Informe origem de criação e entradas direta, demo e HA');
const targets = { direta: direct, demo, ha };
const cases = [];
for (const fragment of ['dentro-do-prazo', 'apos-prazo']) {
  const url = 'https://loja.example/item%2Fp?cor=a%2Bb#' + fragment;
  const created = await fetch(origin + '/api/v1/encurtar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  });
  assert.equal(created.status, 201);
  const { short_url } = await created.json();
  const confirmed = await fetch(short_url, { redirect: 'manual' });
  assert.equal(confirmed.status, 302);
  assert.equal(confirmed.headers.get('location'), url);
  cases.push({ url, short_url, expired: fragment === 'apos-prazo' });
}

async function resolveAt(entry, address, sample) {
  const start = performance.now();
  const r = await fetch(address + '/api/v1/redirecionar', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ short_url: sample.short_url }), signal: AbortSignal.timeout(105000),
  });
  const seconds = (performance.now() - start) / 1000;
  assert.equal(r.status, sample.expired ? 503 : 302, entry);
  assert.equal(r.headers.get('cache-control'), 'no-store', entry);
  assert.equal(r.headers.get('location'), sample.expired ? null : sample.url, entry);
  assert.ok(seconds >= (sample.expired ? 89 : 64), entry);
  console.log(`OK · ${entry} respondeu ${r.status} após ${seconds.toFixed(1)} s`);
}
await Promise.all(cases.flatMap(sample =>
  Object.entries(targets).map(([entry, address]) => resolveAt(entry, address, sample))));
