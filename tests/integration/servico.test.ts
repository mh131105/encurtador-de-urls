import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request, type IncomingMessage } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import test from 'node:test';
import { expiresAt } from '../../src/links/link.js';
import { startService } from '../../src/service.js';
import { writeLink } from '../../src/storage/write.js';
import { withDatabase } from './database.js';

test('com Redis indisponível, a API fica pronta e conclui o POST em curso ao receber SIGTERM', { timeout: 30000 }, async () => {
  await withDatabase(async ({ client, config }) => {
    const createdAt = new Date();
    const code = 'aBc1234';
    const destination = 'https://loja.example/a%2Fb?q=a%2Bb#detalhes';
    await writeLink(client, config.consistency, { code, destination, createdAt, expiresAt: expiresAt(createdAt) });
    // Todas as conexões desse endpoint são encerradas antes de qualquer resposta Redis.
    const cache = createServer(socket => socket.destroy());
    cache.listen(0, '127.0.0.1');
    await once(cache, 'listening');
    try {
      const attempted = once(cache, 'connection');
      const redisPort = (cache.address() as AddressInfo).port;
      const { server, close } = await startService({ ...config, port: 0, redisUrl: `redis://127.0.0.1:${redisPort}` });
      try {
        await attempted;
        const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
        assert.equal((await fetch(origin + '/internal/ready')).status, 200);

        const body = JSON.stringify({ short_url: config.origin + '/' + code });
        const pending = request(origin + '/api/v1/redirecionar', {
          method: 'POST', agent: false,
          headers: { Expect: '100-continue', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        });
        try {
          const accepted = once(pending, 'continue');
          pending.flushHeaders();
          await accepted;
          // O servidor já aceitou o cabeçalho e aguarda o corpo nesta conexão.
          const signaled = once(process, 'SIGTERM');
          process.kill(process.pid, 'SIGTERM');
          await signaled;
          assert.equal(server.listening, false);
          const received = once(pending, 'response');
          pending.end(body);
          const [response] = await received as [IncomingMessage];
          assert.equal(response.statusCode, 302);
          assert.equal(response.headers.location, destination);
          assert.equal(response.headers['cache-control'], 'no-store');
          response.resume();
          await once(response, 'end');
        } finally {
          pending.destroy();
        }
      } finally {
        await close();
      }
    } finally {
      await new Promise<void>(done => cache.close(() => done()));
    }
  });
});
