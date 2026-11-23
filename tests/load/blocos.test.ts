import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type IncomingMessage, type Server } from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplexPair } from 'node:stream';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import cassandra from 'cassandra-driver';
import { loadConfig } from '../../src/config/config.js';
import type { Metrics } from '../../src/http/metrics.js';
import { createCodec, FIRST_ID, parameterFingerprint } from '../../src/ids/codec.js';
import { ROW } from '../../src/ids/recovery.js';
import { startService } from '../../src/service.js';

// Os dois parsers HTTP conversam em memória. Cada chamada termina antes da próxima medição.
async function call(server: Server, path: string, body?: string) {
  const [client, peer] = duplexPair();
  server.emit('connection', peer);
  const req = request({
    path, method: body ? 'POST' : 'GET', createConnection: () => client,
    headers: { Connection: 'close', 'Content-Type': 'application/json' },
  });
  const response = once(req, 'response');
  req.end(body);
  const [res] = await response as [IncomingMessage];
  return { status: res.statusCode, body: await text(res) };
}

async function sample(server: Server) {
  const res = await call(server, '/internal/metrics');
  assert.equal(res.status, 200);
  const metrics: ReturnType<Metrics['snapshot']> = JSON.parse(res.body);
  return { processId: metrics.processId, balance: BigInt(metrics.localIds), writes: metrics.operations.cqlWrite.count,
    errors: metrics.operations.cqlWrite.errors };
}

test('mede dois blocos abandonados e conserva o saldo da réplica sobrevivente', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'enc-blocos-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = loadConfig({ PUBLIC_ORIGIN: 'https://s.example', ID_BLOCK_SIZE: '4',
    FF1_KEY: 'ab'.repeat(16), EMISSION_MARKER_FILE: join(dir, 'emission.json') });
  const fingerprint = parameterFingerprint(config.key, config.tweak);
  const epoch = randomUUID();
  const cap = FIRST_ID + 100n;
  await writeFile(config.markerFile, JSON.stringify({ installation: config.installation, fingerprint,
    epoch, floor: String(FIRST_ID), limit: String(cap), enabled: true }));

  let nextFree = FIRST_ID;
  let loseReservation = false;
  let failWrite = false;
  t.mock.method(cassandra.Client.prototype, 'execute', async (query: string, args: unknown[]) => {
    if (query.startsWith('SELECT * FROM reservations')) {
      assert.deepEqual(args, [ROW]);
      return { first: () => ({ fingerprint, epoch, next_free: nextFree, authorized_until: cap }) };
    }
    if (query.startsWith('UPDATE reservations SET next_free=')) {
      assert.deepEqual(args, [nextFree + 4n, ROW, nextFree, cap, epoch, fingerprint]);
      nextFree += 4n;
      if (loseReservation) {
        loseReservation = false;
        throw new Error('Resposta perdida após aplicar a LWT');
      }
      return { wasApplied: () => true };
    }
    assert.match(query, /^INSERT INTO links /);
    if (failWrite) {
      failWrite = false;
      throw new Error('Gravação do vínculo sem confirmação');
    }
  });
  t.mock.method(net.Server.prototype, 'listen', function (this: net.Server) {
    queueMicrotask(() => this.emit('listening'));
    return this;
  });
  t.mock.method(net, 'createConnection', () => { throw new Error('Redis indisponível'); });
  async function replica() {
    const service = await startService(config);
    t.after(() => service.close());
    return service;
  }
  async function create(server: Server, status = 201) {
    const res = await call(server, '/api/v1/encurtar', '{"url":"https://example.net/destino"}');
    assert.equal(res.status, status);
    if (status === 201) return codec.decode(new URL(JSON.parse(res.body).short_url).pathname.slice(1));
  }

  const codec = createCodec(config.key, config.tweak);
  const a = await replica(), b = await replica();
  assert.equal(await create(a.server), FIRST_ID);
  assert.equal(await create(b.server), FIRST_ID + 4n);
  const aBefore = await sample(a.server), bBefore = await sample(b.server);
  const reservedBefore = nextFree;
  assert.ok(aBefore.processId && bBefore.processId);
  assert.notEqual(aBefore.processId, bBefore.processId);
  for (const replica of [aBefore, bBefore]) {
    assert.partialDeepStrictEqual(replica, { balance: 3n, writes: 1, errors: 0 });
  }

  failWrite = true;
  await create(a.server, 503);
  const aStopped = await sample(a.server);
  assert.deepEqual(aStopped, { processId: aBefore.processId, balance: 2n, writes: 2, errors: 1 });
  await a.close();
  const restarted = await replica();
  const reset = await sample(restarted.server);
  assert.ok(reset.processId);
  assert.notEqual(reset.processId, aBefore.processId);
  assert.partialDeepStrictEqual(reset, { balance: 0n, writes: 0, errors: 0 });
  const beforeLostResponse = nextFree;
  loseReservation = true;
  await create(restarted.server, 503);
  const lostReservationSize = nextFree - beforeLostResponse;
  assert.equal(lostReservationSize, 4n);
  assert.deepEqual(await sample(restarted.server), reset);
  assert.equal(await create(restarted.server), FIRST_ID + 12n);
  assert.equal(await create(b.server), FIRST_ID + 5n);

  const aAfter = await sample(restarted.server), bAfter = await sample(b.server);
  const reserved = nextFree - reservedBefore;
  const writeAttempts = (aStopped.writes - aBefore.writes) + aAfter.writes + (bAfter.writes - bBefore.writes);
  const balancesBefore = aBefore.balance + bBefore.balance;
  const balancesAfter = aAfter.balance + bAfter.balance;
  const abandoned = balancesBefore + reserved - BigInt(writeAttempts) - balancesAfter;
  assert.equal(reserved, 8n);
  assert.equal(writeAttempts, 3);
  assert.deepEqual(aAfter, { processId: reset.processId, balance: 3n, writes: 1, errors: 0 });
  assert.deepEqual(bAfter, { processId: bBefore.processId, balance: 2n, writes: 2, errors: 0 });
  assert.equal(abandoned, 6n);
  assert.equal(abandoned, aStopped.balance + lostReservationSize);
  t.diagnostic(`2 blocos afetados, ${abandoned} posições abandonadas (${aStopped.balance} no reinício e ` +
    `${lostReservationSize} na reserva sem resposta). Saldo final de A e B: ${aAfter.balance} e ${bAfter.balance}.`);

  const end = nextFree;
  assert.equal(await create(b.server), FIRST_ID + 6n);
  assert.equal(await create(b.server), FIRST_ID + 7n);
  assert.equal((await sample(b.server)).balance, 0n);
  assert.equal(nextFree, end);
});
