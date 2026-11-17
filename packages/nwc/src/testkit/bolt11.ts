// A small BOLT11 encoder for tests: signed, decodable invoices without a Lightning node.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';

const TAG = { p: 1, s: 16, d: 13, x: 6, c: 24 } as const;

function intToWords(n: number, minLength = 1): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0) {
    out.unshift(v & 31);
    v = Math.floor(v / 32);
  }
  while (out.length < minLength) out.unshift(0);
  return out;
}

function tagged(tag: number, words: number[]): number[] {
  return [tag, ...intToWords(words.length, 2), ...words];
}

/** 5-bit words to bytes, padding the last byte with zero bits (BOLT11 signing rule). */
function wordsToBytesPadded(words: number[]): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits > 0) out.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

function amountToHrp(msat: number): string {
  if (msat % 100_000_000 === 0) return `${msat / 100_000_000}m`;
  if (msat % 100_000 === 0) return `${msat / 100_000}u`;
  if (msat % 100 === 0) return `${msat / 100}n`;
  return `${msat * 10}p`;
}

export interface EncodeInvoiceInput {
  amountMsat: number;
  paymentHash: Uint8Array;
  paymentSecret: Uint8Array;
  description: string;
  expirySeconds: number;
  timestamp: number;
  nodeKey: Uint8Array;
  network?: 'bc' | 'tb' | 'tbs' | 'bcrt';
}

export function encodeInvoice(i: EncodeInvoiceInput): string {
  const hrp = `ln${i.network ?? 'bc'}${amountToHrp(i.amountMsat)}`;
  const data = [
    ...intToWords(i.timestamp, 7),
    ...tagged(TAG.p, bech32.toWords(i.paymentHash)),
    ...tagged(TAG.s, bech32.toWords(i.paymentSecret)),
    ...tagged(TAG.d, bech32.toWords(new TextEncoder().encode(i.description))),
    ...tagged(TAG.x, intToWords(i.expirySeconds)),
    ...tagged(TAG.c, intToWords(18)),
  ];
  const preimage = new Uint8Array([...new TextEncoder().encode(hrp), ...wordsToBytesPadded(data)]);
  const recovered = secp256k1.sign(sha256(preimage), i.nodeKey, {
    prehash: false,
    format: 'recovered',
  });
  // noble puts the recovery byte first; BOLT11 wants r || s || recovery id.
  const sig = new Uint8Array([...recovered.subarray(1), recovered[0] as number]);
  return bech32.encode(hrp, [...data, ...bech32.toWords(sig)], false);
}

/** The message hash a BOLT11 signature covers, for tests that recover the signer. */
export function signingHash(bolt11: string): { hash: Uint8Array; signature: Uint8Array } {
  const { prefix, words } = bech32.decode(bolt11 as `${string}1${string}`, false);
  const data = words.slice(0, -104);
  const sig = bech32.fromWords(words.slice(-104));
  const hash = sha256(
    new Uint8Array([...new TextEncoder().encode(prefix), ...wordsToBytesPadded(data)]),
  );
  return { hash, signature: Uint8Array.from(sig) };
}
