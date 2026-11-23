import type { IncomingMessage } from 'node:http';
import { isDestination } from '../links/link.js';

export class InvalidRequest extends Error {}

export async function field(req: IncomingMessage, name: string): Promise<string> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new InvalidRequest();
  const chunks: Buffer[] = [];
  let size = 0;
  // Continue draining an oversized request so the client receives the status.
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= 1048576) chunks.push(chunk);
    else throw new InvalidRequest();
  }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))?.[name];
    if (typeof value === 'string') return value;
  } catch { /* invalid JSON or UTF-8 */ }
  throw new InvalidRequest();
}

export async function create(req: IncomingMessage, save: (url: string) => Promise<string>, origin: string) {
  const destination = await field(req, 'url');
  if (!isDestination(destination)) throw new InvalidRequest();
  return { short_url: origin + '/' + await save(destination) };
}
