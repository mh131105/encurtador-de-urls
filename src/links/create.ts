import { expiresAt, type Link } from './link.js';

export function creator(allocate: () => Promise<string>, write: (link: Link) => Promise<void>, now = () => new Date()) {
  return async (destination: string) => {
    const code = await allocate();
    const createdAt = now();
    await write({ code, destination, createdAt, expiresAt: expiresAt(createdAt) });
    return code;
  };
}
