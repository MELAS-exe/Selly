import { createHash, randomBytes, randomInt } from 'node:crypto';

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
