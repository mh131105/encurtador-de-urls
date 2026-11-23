import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import net from 'node:net';
import { Duplex } from 'node:stream';
import test from 'node:test';
import cassandra from 'cassandra-driver';
import { loadConfig } from '../config/config.js';
import { startService } from '../service.js';

async function get(server: Server, path: string) {
  const chunks: Buffer[] = [];
  const connection = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) { chunks.push(chunk); done(); },
  });
  const finished = once(connection, 'finish');
  server.emit('connection', connection);
  connection.push(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
  await finished;
  connection.destroy();
  return Buffer.concat(chunks).toString('latin1');
}

test('sondas com Redis fora do ar acompanham o Cassandra e respeitam o prazo HTTP', { timeout: 3000 }, async t => {
  // O parser HTTP recebe os bytes pelo Duplex, sem abrir uma porta no host.
  t.mock.method(net.Server.prototype, 'listen', function (this: net.Server) {
    queueMicrotask(() => this.emit('listening'));
    return this;
  });
  const redisAttempts = t.mock.method(net, 'createConnection', () => {
    throw new Error('Conexão Redis recusada');
  });
  const query = t.mock.method(cassandra.Client.prototype, 'execute', async () => {});
  const config = loadConfig({
    PUBLIC_ORIGIN: 'https://s.example', FF1_KEY: 'ab'.repeat(16), REQUEST_TIMEOUT_MS: '50',
  });
  const signals = ['SIGTERM', 'SIGINT'] as const;
  const listenersBefore = signals.map(signal => process.listenerCount(signal));
  const service = await startService(config);
  t.after(() => service.close());

  assert.partialDeepStrictEqual(redisAttempts.mock.calls[0]?.arguments[0], { host: '127.0.0.1', port: 6379 });
  assert.match(await get(service.server, '/internal/live'), /^HTTP\/1\.1 200 /);
  assert.equal(query.mock.callCount(), 0);
  assert.match(await get(service.server, '/internal/ready'), /^HTTP\/1\.1 200 /);
  assert.equal(query.mock.calls[0].arguments[0], 'SELECT release_version FROM system.local');

  query.mock.mockImplementationOnce(async () => { throw new Error('Cassandra indisponível'); });
  assert.match(await get(service.server, '/internal/ready'), /^HTTP\/1\.1 503 /);
  assert.match(await get(service.server, '/internal/live'), /^HTTP\/1\.1 200 /);
  assert.equal(query.mock.callCount(), 2);

  const late = Promise.withResolvers<void>();
  query.mock.mockImplementationOnce(() => late.promise);
  try {
    const timedOut = await get(service.server, '/internal/ready');
    assert.match(timedOut, /^HTTP\/1\.1 503 /);
    assert.match(timedOut, /^Connection: close\r?$/im);
  } finally {
    late.resolve();
  }
  assert.match(await get(service.server, '/internal/ready'), /^HTTP\/1\.1 200 /);
  assert.equal(query.mock.callCount(), 4);
  await service.close();
  assert.deepEqual(signals.map(signal => process.listenerCount(signal)), listenersBefore);
});
