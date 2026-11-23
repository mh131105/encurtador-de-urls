import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expiresAt, isActive } from './link.js';

test('validade de dez anos civis em UTC preserva hora, milissegundos e criação', () => {
  for (const [start, end] of [
    ['2030-03-01T12:15:19.532Z', '2040-03-01T12:15:19.532Z'],
    ['2028-02-29T23:00:14.006Z', '2038-02-28T23:00:14.006Z'],
    ['2032-02-29T00:00:00.007Z', '2042-02-28T00:00:00.007Z'],
    ['2030-12-31T23:59:59.999Z', '2040-12-31T23:59:59.999Z'],
  ]) {
    const createdAt = new Date(start);
    const link = { expiresAt: expiresAt(createdAt) };
    assert.equal(createdAt.toISOString(), start);
    assert.equal(link.expiresAt.toISOString(), end);
    assert.equal(isActive(link, new Date(Date.parse(end) - 1)), true);
    assert.equal(isActive(link, new Date(end)), false);
    assert.equal(isActive(link, new Date(Date.parse(end) + 1)), false);
  }
});
