import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cassandra, { type Client } from 'cassandra-driver';
import { loadConfig, type Config } from '../../src/config/config.js';

interface Database {
  client: Client;
  config: Config;
  newClient(): Client;
  applySchema(): Promise<void>;
}

export async function withDatabase<T>(run: (db: Database) => Promise<T>): Promise<T> {
  const keyspace = 'enc_test_' + randomUUID().replaceAll('-', '');
  const dir = await mkdtemp(join(tmpdir(), 'enc-test-'));
  const config = loadConfig({
    ...process.env, CASSANDRA_KEYSPACE: keyspace, PUBLIC_ORIGIN: 'https://s.example',
    FF1_KEY: '2b7e151628aed2a6abf7158809cf4f3c', FF1_TWEAK: '39383736353433323130',
    INSTALLATION_ID: keyspace, ISSUE_ENABLED: 'true', EMISSION_MARKER_FILE: join(dir, 'emission.json')
  });
  const options = {
    contactPoints: config.contactPoints, localDataCenter: config.datacenter, credentials: config.credentials,
    protocolOptions: { port: config.cassandraPort }, encoding: { useBigIntAsLong: true },
    socketOptions: { readTimeout: config.timeoutMs }
  };
  const admin = new cassandra.Client(options);
  const clients: Client[] = [];
  const newClient = () => {
    const client = new cassandra.Client({ ...options, keyspace });
    clients.push(client);
    return client;
  };
  let created = false;
  try {
    await admin.execute(`CREATE KEYSPACE ${keyspace} WITH replication={'class':'NetworkTopologyStrategy','${config.datacenter}':1}`);
    created = true;
    const client = newClient();
    const schema = await readFile('deploy/cassandra/schema.cql', 'utf8');
    const applySchema = async () => {
      for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) await client.execute(stmt);
    };
    await applySchema();
    return await run({ client, config, newClient, applySchema });
  } finally {
    try {
      await Promise.all(clients.map(client => client.shutdown()));
      if (created) await admin.execute(`DROP KEYSPACE ${keyspace}`);
    } finally {
      await admin.shutdown();
      await rm(dir, { recursive: true, force: true });
    }
  }
}
