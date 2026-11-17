import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError } from './errors';

export const sha256Hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');

// No 0/O, 1/I/L: customers read these out and type them.
const NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function orderNumber(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
  return s;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 128 random bits as 22 base62 characters. The only credential of a checkout link. */
export function publicToken(): string {
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`);
  let s = '';
  while (s.length < 22) {
    s = BASE62[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

export const money = (amount: number, currency: 'XOF' | 'SAT') => ({ amount, currency });
export const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().replace(/\.\d{3}Z$/, 'Z') : null;

/** An opaque page cursor: the (created_at, id) of the last row of a page, newest-first lists. */
export const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

export function decodeCursor(c: string): { at: Date; id: string } {
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
  const date = new Date(at ?? '');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor.', {
      errors: [{ field: 'cursor', message: 'Invalid' }],
    });
  }
  return { at: date, id };
}
