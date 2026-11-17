import { createHash, randomBytes } from 'node:crypto';

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7 (RFC 9562): time ordered, so ids sort like created_at. Within one millisecond a 12-bit
 * counter (method 1 of RFC 9562 section 6.2) keeps ids from this process strictly increasing.
 */
export function uuidv7(now = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    ms = lastMs;
    seq++;
    if (seq > 0xfff) {
      ms = ++lastMs;
      seq = 0;
    }
  } else {
    lastMs = ms;
    seq = 0;
  }
  const b = randomBytes(16);
  const big = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((big >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A chat bearer token: 128 bits of randomness, base64url, with a recognisable prefix. */
export function newChatToken(): string {
  return `ct_${randomBytes(16).toString('base64url')}`;
}

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** A short, stable label for an anonymous visitor, such as « Visiteur 7H2Q ». */
export function visitorLabel(seed: string): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const digest = sha256(seed);
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[(digest[i] as number) % alphabet.length];
  return `Visiteur ${out}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
