import { decode } from 'light-bolt11-decoder';
import { NwcError } from './errors';

export type LightningNetwork = 'mainnet' | 'testnet' | 'signet' | 'regtest';
const PREFIX: Record<LightningNetwork, string> = {
  mainnet: 'bc',
  testnet: 'tb',
  signet: 'tbs',
  regtest: 'bcrt',
};

export interface DecodedInvoice {
  amountMsat: number;
  paymentHash: string;
  createdAt: Date;
  expiresAt: Date;
  expirySeconds: number;
}

export function decodeInvoice(bolt11: string): DecodedInvoice & { network: string | null } {
  const d = decode(bolt11);
  let amountMsat = 0;
  let paymentHash = '';
  let timestamp = 0;
  let network: string | null = null;
  for (const s of d.sections) {
    if (s.name === 'amount') amountMsat = Number(s.value);
    else if (s.name === 'payment_hash') paymentHash = s.value;
    else if (s.name === 'timestamp') timestamp = s.value;
    else if (s.name === 'coin_network') network = s.letters;
  }
  return {
    amountMsat,
    paymentHash,
    createdAt: new Date(timestamp * 1000),
    expirySeconds: d.expiry,
    expiresAt: new Date((timestamp + d.expiry) * 1000),
    network,
  };
}

/**
 * A wallet's answer must never become an order unless it matches the request (architecture.md section 3.6):
 * the right network, the exact amount, the payment hash the wallet reported, and an expiry that is in the future
 * and not longer than asked. Returns the decoded invoice; its expiry is the one that counts.
 */
export function checkInvoice(
  bolt11: string,
  expected: {
    amountMsat: number;
    paymentHash: string;
    maxExpirySeconds: number;
    network: LightningNetwork;
    now: Date;
  },
): DecodedInvoice {
  let d: ReturnType<typeof decodeInvoice>;
  try {
    d = decodeInvoice(bolt11);
  } catch (err) {
    throw new NwcError(
      'NWC_BAD_INVOICE',
      `The wallet returned an invoice that cannot be decoded: ${(err as Error).message}`,
    );
  }
  const bad = (why: string) =>
    new NwcError('NWC_BAD_INVOICE', `The wallet returned a wrong invoice: ${why}.`);
  if (d.network !== PREFIX[expected.network])
    throw bad(`network ${d.network ?? 'unknown'}, expected ${PREFIX[expected.network]}`);
  if (d.amountMsat !== expected.amountMsat)
    throw bad(`amount ${d.amountMsat} msat, expected ${expected.amountMsat}`);
  if (d.paymentHash !== expected.paymentHash.toLowerCase())
    throw bad('the payment hash does not match');
  if (d.expirySeconds > expected.maxExpirySeconds + 5)
    throw bad(`expiry ${d.expirySeconds} s, asked for ${expected.maxExpirySeconds}`);
  if (d.expiresAt.getTime() <= expected.now.getTime() + 30_000)
    throw bad('it is already expired or about to');
  return d;
}
