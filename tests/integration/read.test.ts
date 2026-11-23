import test from 'node:test';
import assert from 'node:assert/strict';
import { writeLink } from '../../src/storage/write.js';
import { readLink } from '../../src/storage/read.js';
import { withDatabase } from './database.js';

test('leitura em outra conexão distingue vínculo, ausência e falha do banco', async () => {
  await withDatabase(async ({ client, config, newClient }) => {
    const reader = newClient();
    const link = {
      code: 'Aa0000z', destination: 'https://ex.example/%2c?q=%2B#sec',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60000)
    };
    await writeLink(client, config.consistency, link);
    assert.deepEqual(await readLink(reader, config.consistency, link.code), link);
    assert.equal(await readLink(reader, config.consistency, 'aa0000z'), null);
    await reader.shutdown();
    await assert.rejects(readLink(reader, config.consistency, link.code));
  });
});
