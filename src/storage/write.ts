import type { Client } from 'cassandra-driver';
import type { Link } from '../links/link.js';

export async function writeLink(client: Client, consistency: number, link: Link, now = new Date(), clockToleranceSeconds = 2): Promise<void> {
  const remaining = link.expiresAt.getTime() - now.getTime();
  if (remaining <= 0) throw new RangeError('Vínculo já vencido');
  // O TTL físico usa segundos inteiros. A API aplica o instante civil exato.
  const ttl = Math.ceil(remaining / 1000) + 1 + clockToleranceSeconds;
  await client.execute(
    'INSERT INTO links (code, destination, created_at, expires_at) VALUES (?, ?, ?, ?) USING TTL ?',
    [link.code, link.destination, link.createdAt, link.expiresAt, ttl],
    { prepare: true, consistency, isIdempotent: false }
  );
}
