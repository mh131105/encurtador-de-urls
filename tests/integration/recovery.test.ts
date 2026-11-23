import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createAppServer } from '../../src/server.js';
import { createIssuer } from '../../src/ids/allocator.js';
import { createCodec, DOMAIN_END, FIRST_ID } from '../../src/ids/codec.js';
import { administer, ROW } from '../../src/ids/recovery.js';
import { creator } from '../../src/links/create.js';
import { resolver } from '../../src/links/resolve.js';
import { writeLink } from '../../src/storage/write.js';
import { readLink } from '../../src/storage/read.js';
import { withDatabase } from './database.js';

test('snapshot lógico CQL defasado: HTTP somente leitura, retomada acima da marca e fim do domínio', async () => {
  await withDatabase(async ({ client, config }) => {
    config.blockSize = 1n;
    await administer(client, config, 'init', FIRST_ID + 32n);
    await administer(client, config, 'extend', DOMAIN_END - 2n);
    let issuer = createIssuer(client, config);
    const server = createAppServer({
      origin: config.origin,
      create: creator(() => issuer.nextCode(), link => writeLink(client, config.consistency, link)),
      resolve: resolver({ get: async () => null, put: async () => {} }, code => readLink(client, config.consistency, code))
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const create = (url: string) => fetch(base + '/api/v1/encurtar', {
      method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ url })
    });
    const confirmed = async (url: string) => {
      const response = await create(url);
      assert.equal(response.status, 201);
      return new URL(((await response.json()) as {short_url:string}).short_url).pathname.slice(1);
    };
    const open = (code: string) => fetch(base + '/' + code, {redirect:'manual'});
    const failed = async () => {
      const response = await create('https://example.net/novo');
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('location'), null);
    };
    try {
      const kept = await confirmed('https://example.net/mantido');
      const snapshot = (await client.execute('SELECT * FROM reservations WHERE installation=?', [ROW], {prepare:true})).first();
      const lost = await confirmed('https://example.net/apos-snapshot');
      await administer(client, config, 'freeze');
      await failed();
      // Restaura o conjunto de vínculos e os metadados da cópia lógica anterior.
      await client.execute('DELETE FROM links WHERE code=?', [lost], {prepare:true});
      await client.execute('UPDATE reservations SET next_free=?, authorized_until=?, epoch=?, fingerprint=? WHERE installation=?',
        [snapshot.next_free, snapshot.authorized_until, snapshot.epoch, snapshot.fingerprint, ROW], {prepare:true});
      issuer = createIssuer(client, config);
      await failed();
      const saved = await open(kept);
      assert.equal(saved.status, 302);
      assert.equal(saved.headers.get('location'), 'https://example.net/mantido');
      const backup = await readFile(config.markerFile);
      await rename(config.markerFile, config.markerFile + '.backup');
      await failed();
      await assert.rejects(administer(client, config, 'resume', DOMAIN_END));
      await assert.rejects(administer(client, config, 'init', DOMAIN_END));
      await writeFile(config.markerFile, backup);
      await administer(client, config, 'resume', DOMAIN_END);
      const codec = createCodec(config.key, config.tweak);
      const first = await confirmed('https://example.net/novo-1');
      const last = await confirmed('https://example.net/ultimo');
      assert.equal(codec.decode(first), DOMAIN_END - 2n);
      assert.equal(codec.decode(last), DOMAIN_END - 1n);
      const row = (await client.execute('SELECT next_free,authorized_until FROM reservations WHERE installation=?', [ROW], {prepare:true})).first();
      assert.equal(row.next_free, DOMAIN_END);
      assert.equal(row.authorized_until, DOMAIN_END);
      await failed();
      assert.equal((await open(last)).headers.get('location'), 'https://example.net/ultimo');
      assert.equal((await open(kept)).headers.get('location'), 'https://example.net/mantido');
      assert.equal((await open(lost)).status, 404);
      await assert.rejects(administer(client, config, 'extend', DOMAIN_END + 1n));
    } finally {
      await new Promise<void>(done => server.close(() => done()));
    }
  });
});

test('init recusa keyspace restaurado com vínculos quando a marca e o alocador desapareceram', async t => {
  const { unlink } = await import('node:fs/promises');
  const { post, start } = await import('../contract/http.js');
  await withDatabase(async ({ client, config }) => {
    const limit = FIRST_ID + 10n;
    await administer(client, config, 'init', limit);
    const makeIssuer = () => createIssuer(client, config);
    let issuer = makeIssuer();
    const origin = await start(t, {
      origin: config.origin,
      create: creator(() => issuer.nextCode(), link => writeLink(client, config.consistency, link)),
      resolve: resolver({ get: async () => null, put: async () => {} }, code => readLink(client, config.consistency, code))
    });
    const dest = 'https://example.net/destino-original';
    const created = await post(origin, '/api/v1/encurtar', JSON.stringify({url:dest}));
    assert.equal(created.status, 201);
    const path = new URL(((await created.json()) as {short_url:string}).short_url).pathname;
    await unlink(config.markerFile);
    await client.execute('DELETE FROM reservations WHERE installation=?', [ROW], {prepare:true});
    issuer = makeIssuer();
    await assert.rejects(administer(client, config, 'init', limit), /vínculos/);
    const refused = await post(origin, '/api/v1/encurtar', JSON.stringify({url:'https://example.net/substituto'}));
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get('location'), null);
    const saved = await fetch(origin + path, {redirect:'manual'});
    assert.equal(saved.status, 302);
    assert.equal(saved.headers.get('location'), dest);
  });
});
