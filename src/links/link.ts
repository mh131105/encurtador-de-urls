export interface Link {
  readonly code: string;
  readonly destination: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface LinkReader {
  read(code: string): Promise<Link | null>;
}

export interface LinkWriter {
  write(link: Link): Promise<void>;
}

export function expiresAt(createdAt: Date): Date {
  const end = new Date(createdAt);
  end.setUTCFullYear(createdAt.getUTCFullYear() + 10);
  // Em ano comum, Date normaliza 29/02 para 01/03. O contrato vence em 28/02.
  if (end.getUTCMonth() !== createdAt.getUTCMonth()) end.setUTCDate(0);
  return end;
}

export function isActive(link: Pick<Link, 'expiresAt'>, now: Date): boolean {
  return now.getTime() < link.expiresAt.getTime();
}

export function isDestination(destination: unknown): destination is string {
  if (typeof destination !== 'string' || !destination.isWellFormed()) return false;
  try {
    if (!/^https?:\/\/[^/?#\\\s]/i.test(destination) || /[\s\\\u0000-\u001f\u007f]/u.test(destination)) return false;
    return Boolean(new URL(destination).hostname);
  } catch { return false; }
}
