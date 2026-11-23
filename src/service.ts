import { once } from 'node:events';
import cassandra from 'cassandra-driver';
import type { Config } from './config/config.js';
import { createAppServer } from './http/server.js';
import { openRedis, RedisCache } from './cache/redis.js';
import { createIssuer } from './ids/allocator.js';
import { creator } from './links/create.js';
import { resolver } from './links/resolve.js';
import { readLink } from './storage/read.js';
import { writeLink } from './storage/write.js';
import { ready } from './http/health.js';
import { Metrics } from './http/metrics.js';

export function database(config: Config) {
  return new cassandra.Client({
    contactPoints: config.contactPoints, localDataCenter: config.datacenter, keyspace: config.keyspace,
    credentials: config.credentials, protocolOptions: { port: config.cassandraPort },
    encoding: { useBigIntAsLong: true },
    socketOptions: { connectTimeout: config.timeoutMs, readTimeout: config.timeoutMs },
    policies: { retry: new cassandra.policies.retry.FallthroughRetryPolicy() },
    pooling: { coreConnectionsPerHost: { [cassandra.types.distance.local]: 1 }, maxRequestsPerConnection: 1024 },
  });
}

export async function startService(config: Config) {
  const client = database(config);
  const redis = openRedis(config.redisUrl, config.cacheTimeoutMs);
  const cache = new RedisCache(redis, config.installation, config.cacheTtlSeconds, config.cacheTimeoutMs);
  const issuer = createIssuer(client, config);
  const metrics = new Metrics();
  const server = createAppServer({
    ...config, ready: () => ready(client), metrics, localIds: issuer.remaining,
    create: creator(issuer.nextCode, link => metrics.measure('cqlWrite',
      () => writeLink(client, config.consistency, link, new Date(), config.clockToleranceSeconds))),
    resolve: resolver(cache, code => metrics.measure('cqlRead',
      () => readLink(client, config.consistency, code)), undefined, () => { metrics.cacheHits++; }),
  });
  let shutdown: Promise<void> | undefined;
  function stop() {
    void close().catch(() => { process.exitCode = 1; });
  }
  function close(): Promise<void> {
    shutdown ??= (async () => {
      const deadline = setTimeout(() => server.closeAllConnections(), config.requestTimeoutMs);
      try {
        if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
      } finally {
        clearTimeout(deadline);
        metrics.close();
        if (redis.isOpen) redis.destroy();
        await client.shutdown();
      }
    })().finally(() => {
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
    });
    return shutdown;
  }
  try {
    server.listen(config.port);
    await once(server, 'listening');
  } catch (err) {
    await close();
    throw err;
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return { server, close };
}
