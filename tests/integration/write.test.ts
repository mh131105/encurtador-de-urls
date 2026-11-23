import test from 'node:test';
import assert from 'node:assert/strict';
import { writeLink } from '../../src/storage/write.js';
import { withDatabase } from './database.js';
import { FIRST_ID } from '../../src/ids/codec.js';
import { administer, ROW } from '../../src/ids/recovery.js';
import { createIssuer } from '../../src/ids/allocator.js';

test('esquema idempotente, expiração após 2038 e regravação com o prazo original', async () => {
  await withDatabase(async ({ client, config, applySchema }) => {
    await administer(client, config, 'init', FIRST_ID + 2000n);
    await createIssuer(client, config).nextCode();
    const state = async () => (await client.execute('SELECT next_free FROM reservations WHERE installation=?', [ROW], { prepare: true })).first().next_free;
    const next = await state();
    assert.equal(next, FIRST_ID + config.blockSize);
    await applySchema();
    assert.equal(await state(), next);
    const link = {
      code: '00AbCz9', destination: 'https://s.example/a%2Fb?c=%2B#frag',
      createdAt: new Date('2030-01-01T00:00:00.100Z'), expiresAt: new Date('2040-01-01T00:00:00.100Z')
    };
    const inspect = async () => (await client.execute(
      'SELECT destination,created_at,expires_at,ttl(destination) AS remaining FROM links WHERE code=?', [link.code], { prepare: true }
    )).first();
    // Relógio real no primeiro write comprova TTL físico ultrapassando 2038.
    const first = new Date();
    await writeLink(client, config.consistency, link, first);
    const row = await inspect();
    assert.equal(row.destination, link.destination);
    assert.equal(row.expires_at.toISOString(), link.expiresAt.toISOString());
    assert.equal(row.created_at.toISOString(), link.createdAt.toISOString());
    assert.ok(Date.now() + row.remaining * 1000 > Date.UTC(2038, 1));
    const later = new Date(first.getTime() + 86400000);
    await writeLink(client, config.consistency, link, later);
    const retried = await inspect();
    assert.equal(retried.expires_at.toISOString(), row.expires_at.toISOString());
    assert.ok(Math.abs(row.remaining - retried.remaining - 86400) <= 2);
    await assert.rejects(writeLink(client, config.consistency, link, link.expiresAt));
  });
});
