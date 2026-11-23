import { createServer, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { create, InvalidRequest } from './create.js';
import { codePath, postedCode, redirectLocation } from './redirect.js';
import type { Metrics } from './metrics.js';

export interface Routes {
  origin: string;
  create(url: string): Promise<string>;
  resolve(code: string, remainingMs: number): Promise<string | null>;
  ready?(): Promise<boolean>;
  metrics?: Metrics;
  localIds?(): bigint;
  requestTimeoutMs?: number;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createAppServer(routes: Routes) {
  const deadline = routes.requestTimeoutMs ?? 15000;
  return createServer({ requestTimeout: deadline, headersTimeout: deadline }, async (req, res) => {
    const path = req.url ?? '';
    const started = performance.now();
    res.setHeader('Cache-Control', 'no-store');
    const timer = setTimeout(() => {
      if (!res.headersSent) { res.writeHead(503, { Connection: 'close' }); res.end(); }
    }, deadline);
    res.once('close', () => clearTimeout(timer));
    const post = req.method === 'POST';
    const get = req.method === 'GET';
    const createPost = post && path === '/api/v1/encurtar';
    const resolvePost = post && path === '/api/v1/redirecionar';
    const match = get ? codePath.exec(path.split('?')[0]) : null;
    if (createPost || resolvePost || match) {
      res.once('finish', () => routes.metrics?.observe(createPost ? 'create' : 'resolve', started, res.statusCode >= 400));
    }
    try {
      if (get && path === '/internal/live') { res.end(); return; }
      if (get && path === '/internal/ready' && routes.ready) {
        const ready = await routes.ready();
        if (!res.writableEnded) { res.writeHead(ready ? 200 : 503); res.end(); }
        return;
      }
      if (get && path === '/internal/metrics' && routes.metrics) {
        json(res, 200, routes.metrics.snapshot(routes.localIds?.() ?? 0n)); return;
      }
      if (createPost) {
        const body = await create(req, routes.create, routes.origin);
        if (!res.writableEnded) json(res, 201, body);
        return;
      }
      if (resolvePost || match) {
        const code = match ? match[1] : await postedCode(req, routes.origin);
        if (res.writableEnded) return;
        const remainingMs = deadline - (performance.now() - started);
        if (remainingMs <= 0) { res.writeHead(503); res.end(); return; }
        const location = await routes.resolve(code, remainingMs);
        if (res.writableEnded) return;
        if (location) { res.writeHead(302, { Location: redirectLocation(location) }); res.end(); return; }
      }
      res.writeHead(404);
      res.end();
    } catch (err) {
      if (!res.writableEnded) { res.writeHead(err instanceof InvalidRequest ? 400 : 503); res.end(); }
    }
  });
}
