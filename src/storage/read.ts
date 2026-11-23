import type { Client } from 'cassandra-driver';
import type { Link } from '../links/link.js';

export async function readLink(client: Client, consistency: number, code: string): Promise<Link | null> {
  const result = await client.execute(
    'SELECT code, destination, created_at, expires_at FROM links WHERE code = ?', [code],
    { prepare: true, consistency, isIdempotent: true }
  );
  const row = result.first();
  return row ? { code: row.code, destination: row.destination, createdAt: row.created_at, expiresAt: row.expires_at } : null;
}
