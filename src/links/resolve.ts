import { isActive, type Link } from './link.js';

export interface DestinationCache {
  get(code: string, maxWaitMs?: number): Promise<Pick<Link, 'destination' | 'expiresAt'> | null>;
  put(link: Link): Promise<void>;
}
export function resolver(
  cache: DestinationCache, read: (code: string) => Promise<Link | null>,
  now = () => new Date(), hit: () => void = () => {},
) {
  return async (code: string, remainingMs = Infinity) => {
    // Reserva ao menos metade do tempo restante para uma leitura persistente.
    const cacheBudget = Math.floor(remainingMs / 2);
    const cached = cacheBudget > 0 ? await cache.get(code, cacheBudget) : null;
    if (cached && isActive(cached, now())) {
      hit();
      return cached.destination;
    }
    const link = await read(code);
    if (!link || !isActive(link, now())) return null;
    // O SET tem prazo próprio. A resposta depende apenas da leitura já confirmada.
    void cache.put(link).catch(() => {});
    return isActive(link, now()) ? link.destination : null;
  };
}
