import type { Client } from 'cassandra-driver';

export async function ready(client: Client) {
  try {
    await client.execute('SELECT release_version FROM system.local');
    return true;
  } catch { return false; }
}
