import type { Client } from 'cassandra-driver';
import type { Config } from '../config/config.js';
import { reserveBlock, type Block } from '../storage/allocator.js';
import { createCodec, parameterFingerprint } from './codec.js';
import { readMarker, type Marker } from './recovery.js';

export function createIssuer(client: Client, config: Pick<Config,
  'key' | 'tweak' | 'installation' | 'blockSize' | 'consistency' | 'markerFile' | 'issueEnabled'>,
  reserve: (marker: Marker) => Promise<Block> = marker => reserveBlock(client, config.consistency, config.blockSize, marker)) {
  const codec = createCodec(config.key, config.tweak);
  const fingerprint = parameterFingerprint(config.key, config.tweak);
  let next = 0n, end = 0n;
  let authorization: Marker | undefined;
  let pending: Promise<void> | undefined;
  return {
    remaining: () => end - next,
    async nextCode(): Promise<string> {
      if (!config.issueEnabled) throw new Error('Emissão suspensa');
      while (true) {
        const marker = await readMarker(config.markerFile, config.installation, fingerprint);
        if (!marker.enabled) throw new Error('Emissão suspensa');
        if (authorization?.epoch === marker.epoch) {
          if (authorization.floor !== marker.floor || BigInt(marker.limit) < BigInt(authorization.limit)) {
            throw new Error('Marca externa retrocedeu durante a emissão');
          }
          authorization = marker;
          if (next < end) return codec.encode(next++);
        }
        if (!pending) {
          pending = reserve(marker).then(block => {
            next = block.start;
            end = block.end;
            authorization = marker;
          }).finally(() => { pending = undefined; });
        }
        await pending;
      }
    }
  };
}
