import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import cassandra, { type Client } from 'cassandra-driver';
import { loadConfig, type Config } from '../config/config.js';
import { DOMAIN_END, FIRST_ID, parameterFingerprint } from './codec.js';

type Identity = Pick<Config, 'installation' | 'key' | 'tweak' | 'markerFile'>;
export interface Marker {
  installation: string;
  fingerprint: string;
  epoch: string;
  floor: string;
  limit: string;
  enabled: boolean;
}

export async function readMarker(path: string, installation: string, fingerprint: string): Promise<Marker> {
  const m = JSON.parse(await readFile(path, 'utf8'));
  if (!m || m.installation !== installation || m.fingerprint !== fingerprint ||
      typeof m.epoch !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(m.epoch) ||
      typeof m.enabled !== 'boolean' || typeof m.floor !== 'string' || !/^\d+$/.test(m.floor) ||
      typeof m.limit !== 'string' || !/^\d+$/.test(m.limit) || BigInt(m.floor) < FIRST_ID ||
      BigInt(m.limit) > DOMAIN_END || BigInt(m.floor) >= BigInt(m.limit)) {
    throw new Error('Marca externa inválida');
  }
  return m;
}

async function saveMarker(path: string, marker: Marker): Promise<void> {
  const temp = path + '.' + randomUUID();
  const out = await open(temp, 'wx', 0o640);
  try {
    await out.writeFile(JSON.stringify(marker) + '\n');
    await out.sync();
  } finally {
    await out.close();
  }
  await rename(temp, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export const ROW = 'principal';
export type AdminAction = 'init' | 'freeze' | 'extend' | 'resume';

// Um único registro por keyspace também impede que uma mudança acidental de
// INSTALLATION_ID habilite um segundo alocador sobre a mesma tabela de links.
export async function administer(client: Client, config: Identity & Pick<Config, 'consistency'>,
                                 action: AdminAction, limit?: bigint): Promise<void> {
  const { installation, markerFile, consistency } = config;
  const fingerprint = parameterFingerprint(config.key, config.tweak);
  if (action !== 'freeze' && (limit === undefined || limit <= FIRST_ID || limit > DOMAIN_END)) {
    throw new Error('Teto exclusivo fora do domínio');
  }

  const lockPath = markerFile + '.lock';
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    let old: Marker | undefined;
    try { old = await readMarker(markerFile, installation, fingerprint); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (action === 'freeze') {
      if (!old) throw new Error('Marca externa ausente');
      await saveMarker(markerFile, { ...old, enabled: false });
      return;
    }
    const cql = { prepare: true, consistency, serialConsistency: cassandra.types.consistencies.localSerial, isIdempotent: false };
    const row = (await client.execute('SELECT * FROM reservations WHERE installation=?', [ROW], cql)).first();
    if (action === 'init') {
      if (old || row) throw new Error('Emissão já inicializada ou marca preexistente');
      const existing = await client.execute('SELECT code FROM links LIMIT 1', [], { consistency: cassandra.types.consistencies.all });
      if (existing.first()) throw new Error('Keyspace contém vínculos de uma emissão anterior');
    }
    if (action === 'resume' && (!old || old.enabled || limit! <= BigInt(old.limit))) {
      throw new Error('A retomada exige marca congelada e teto superior');
    }
    if (row && row.fingerprint !== fingerprint) throw new Error('Parâmetros FF1 incompatíveis');
    if (action === 'extend') {
      if (!row || !old?.enabled || row.epoch.toString() !== old.epoch ||
          limit! < BigInt(old.limit) || row.authorized_until > BigInt(old.limit) || row.next_free < BigInt(old.floor)) throw new Error('Extensão incompatível');
      if (row.authorized_until === limit! && BigInt(old.limit) === limit!) return;
    }
    if (action === 'resume' && row &&
        (row.authorized_until > BigInt(old!.limit) || row.next_free > BigInt(old!.limit))) {
      throw new Error('Marca externa está abaixo de uma reserva conhecida');
    }
    const marker: Marker = {
      installation, fingerprint,
      epoch: action === 'extend' ? old!.epoch : randomUUID(),
      floor: action === 'extend' ? old!.floor : action === 'resume' ? old!.limit : FIRST_ID.toString(),
      limit: limit!.toString(), enabled: true
    };
    // A marca durável deve preceder qualquer autorização no banco.
    await saveMarker(markerFile, marker);
    const epoch = cassandra.types.Uuid.fromString(marker.epoch);
    let result;
    if (!row) {
      result = await client.execute(
        'INSERT INTO reservations (installation,next_free,authorized_until,fingerprint,epoch) VALUES (?,?,?,?,?) IF NOT EXISTS',
        [ROW, BigInt(marker.floor), limit, fingerprint, epoch], cql);
    } else if (action === 'extend') {
      result = await client.execute(
        'UPDATE reservations SET authorized_until=? WHERE installation=? IF epoch=? AND fingerprint=? AND authorized_until=?',
        [limit, ROW, row.epoch, fingerprint, row.authorized_until], cql);
    } else {
      // Na restauração, processos da geração anterior já foram isolados pelo operador.
      result = await client.execute(
        'UPDATE reservations SET next_free=?, authorized_until=?, epoch=? WHERE installation=? IF fingerprint=? AND epoch=? AND next_free=? AND authorized_until=?',
        [BigInt(marker.floor), limit, epoch, ROW, fingerprint, row.epoch, row.next_free, row.authorized_until], cql);
    }
    if (!result.wasApplied()) throw new Error('Autorização não confirmada pelo Cassandra');
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

if (import.meta.main) {
  const [action, rawLimit] = process.argv.slice(2);
  if (!['init','freeze','extend','resume'].includes(action) ||
      (action === 'freeze' ? rawLimit !== undefined : !/^\d+$/.test(rawLimit ?? ''))) {
    throw new Error('Uso: node dist/ids/recovery.js init|extend|resume TETO ou freeze');
  }
  const config = loadConfig();
  const client = new cassandra.Client({
    contactPoints: config.contactPoints, localDataCenter: config.datacenter, keyspace: config.keyspace,
    protocolOptions: { port: config.cassandraPort }, credentials: config.credentials,
    encoding: { useBigIntAsLong: true }, socketOptions: { readTimeout: config.timeoutMs }
  });
  try { await administer(client, config, action as AdminAction, rawLimit ? BigInt(rawLimit) : undefined); }
  finally { await client.shutdown(); }
}
