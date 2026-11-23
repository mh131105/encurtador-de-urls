import type { IncomingMessage } from 'node:http';
import { domainToASCII } from 'node:url';
import { field, InvalidRequest } from './create.js';

const nonAscii = /[^\x00-\x7f]/u;

export function redirectLocation(destination: string): string {
  if (!nonAscii.test(destination)) return destination;
  // Em um host com escapes, codifique só os caracteres literais para preservar os escapes originais.
  const withAsciiHost = destination.replace(/^(https?:\/\/(?:[^/?#]*@)?)([^:/?#]+)/i,
    (authority, prefix: string, host: string) => nonAscii.test(host) && !host.includes('%') ? prefix + domainToASCII(host) : authority);
  return withAsciiHost.replace(/[^\x00-\x7f]+/gu, encodeURIComponent);
}

export const codePath = /^\/([A-Za-z0-9]{7})$/;
export async function postedCode(req: IncomingMessage, origin: string) {
  const value = await field(req, 'short_url');
  try {
    const parsed = new URL(value);
    const literal = /^https?:\/\/[^/?#@\\\s]+(\/[A-Za-z0-9]{7})$/i.exec(value);
    if (parsed.origin === origin && literal && literal[1] === parsed.pathname) return literal[1].slice(1);
  } catch { /* malformed short URL */ }
  throw new InvalidRequest();
}
