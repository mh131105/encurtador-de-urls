import cassandra, { type Client } from 'cassandra-driver';
import { DOMAIN_END } from '../ids/codec.js';
import { ROW, type Marker } from '../ids/recovery.js';

export interface Block { start: bigint; end: bigint; }
const lastCapacityWarning = new WeakMap<Client, { epoch: string; cap: bigint }>();

function warnCapacity(client: Client, epoch: string, cap: bigint, message: string) {
  const previous = lastCapacityWarning.get(client);
  if (previous?.epoch === epoch && previous.cap === cap) return;
  lastCapacityWarning.set(client, { epoch, cap });
  console.warn(message);
}

export async function reserveBlock(client: Client, consistency: number, size: bigint, marker: Marker): Promise<Block> {
  if (!marker.enabled || size <= 0n) throw new Error('Emissão suspensa');
  const opts = { consistency, prepare: true, serialConsistency: cassandra.types.consistencies.localSerial, isIdempotent: false };
  for (let attempt = 0; attempt < 32; attempt++) {
    const row = (await client.execute('SELECT * FROM reservations WHERE installation=?', [ROW], opts)).first();
    if (!row || row.fingerprint !== marker.fingerprint || row.epoch.toString() !== marker.epoch ||
        typeof row.next_free !== 'bigint' || typeof row.authorized_until !== 'bigint' ||
        row.next_free < BigInt(marker.floor) || row.authorized_until > BigInt(marker.limit) ||
        row.authorized_until > DOMAIN_END) throw new Error('Autorização de emissão inválida');
    const start: bigint = row.next_free;
    const cap: bigint = row.authorized_until;
    if (start >= cap) {
      warnCapacity(client, marker.epoch, cap, 'Faixa autorizada de IDs esgotada para novas reservas.');
      throw new Error('Faixa autorizada de IDs esgotada');
    }
    const end = start + size > cap ? cap : start + size;
    const result = await client.execute(
      'UPDATE reservations SET next_free=? WHERE installation=? IF next_free=? AND authorized_until=? AND epoch=? AND fingerprint=?',
      [end, ROW, start, cap, row.epoch, marker.fingerprint], opts);
    if (result.wasApplied()) {
      if (end === cap) {
        warnCapacity(client, marker.epoch, cap, 'Último bloco reservado. Ao consumi-lo, a criação exigirá uma nova faixa segura.');
      }
      return { start, end };
    }
  }
  throw new Error('Reserva não confirmada após concorrência');
}
