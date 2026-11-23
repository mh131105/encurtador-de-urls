import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { createAppServer, type Routes } from '../../src/server.js';

export const publicOrigin = 'https://s.example';

export async function start(t: TestContext, routes: Partial<Routes>): Promise<string> {
  const server = createAppServer({
    origin: publicOrigin,
    create: async () => { throw new Error('criação inesperada'); },
    resolve: async () => { throw new Error('resolução inesperada'); },
    ...routes,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((done, fail) => {
    server.close(err => err ? fail(err) : done());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export function post(origin: string, path: string, body: string) {
  return fetch(origin + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'manual', body,
  });
}
