import { createClient } from 'redis';
import { isActive, isDestination, type Link } from '../links/link.js';

type CachedLink = Pick<Link, 'destination' | 'expiresAt'>;

export function openRedis(url: string, timeoutMs: number) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 1024,
    socket: { connectTimeout: timeoutMs },
  });
  // A sonda depende do Cassandra. Redis pode se reconectar sem bloquear o HTTP.
  client.on('error', () => {});
  void client.connect().catch(() => {});
  return client;
}

// O timeout da fila do driver termina quando o comando chega ao socket.
// Limitar também a espera da resposta permite recorrer ao banco mesmo nesse caso.
async function bounded<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Redis não respondeu a tempo')), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

interface Client {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { expiration: { type: 'PX'; value: number } }): Promise<unknown>;
}

export class RedisCache {
  constructor(
    private readonly client: Client,
    private readonly prefix: string,
    private readonly ttlSeconds: number,
    private readonly timeoutMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(code: string, maxWaitMs = this.timeoutMs): Promise<CachedLink | null> {
    try {
      const value = await bounded(this.client.get(`${this.prefix}:${code}`), Math.min(this.timeoutMs, maxWaitMs));
      if (value === null) return null;
      const data: unknown = JSON.parse(value);
      if (!data || typeof data !== 'object' || !('destination' in data) || !isDestination(data.destination) ||
          !('expiresAt' in data) || typeof data.expiresAt !== 'number' || !Number.isSafeInteger(data.expiresAt)) return null;
      const link = { destination: data.destination, expiresAt: new Date(data.expiresAt) };
      return isActive(link, this.now()) ? link : null;
    } catch {
      return null;
    }
  }

  async put(link: CachedLink & Pick<Link, 'code'>): Promise<void> {
    const end = link.expiresAt.getTime();
    const ttl = Math.min(this.ttlSeconds * 1000, end - this.now().getTime());
    if (!(ttl > 0)) return;
    try {
      const value = JSON.stringify({ destination: link.destination, expiresAt: end });
      await bounded(this.client.set(`${this.prefix}:${link.code}`, value, {
        expiration: { type: 'PX', value: ttl },
      }), this.timeoutMs);
    } catch {
      // O vínculo já foi confirmado no banco; o cache é opcional.
    }
  }
}
