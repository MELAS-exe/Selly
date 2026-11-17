import { getPublicKey } from 'nostr-tools/pure';
import { NwcError } from './errors';

export interface ParsedNwcUri {
  walletPubkey: string;
  relays: string[];
  /** The client secret key (hex). A credential: never log it. */
  secret: string;
  /** Public key of `secret`, used in relay filters. */
  clientPubkey: string;
  lud16: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const SCHEMES = ['nostr+walletconnect:', 'nostrwalletconnect:'];

/**
 * Parse and validate `nostr+walletconnect://<wallet pubkey>?relay=wss://...&secret=<hex>[&lud16=...]` (NIP-47).
 * Relays must use wss:// unless `allowInsecureRelays` (local tests only).
 * Error messages never contain the secret.
 */
export function parseNwcUri(
  uri: string,
  opts: { allowInsecureRelays?: boolean } = {},
): ParsedNwcUri {
  const invalid = (why: string) =>
    new NwcError('NWC_URI_INVALID', `Invalid NWC connection URI: ${why}.`);
  const trimmed = uri.trim();
  const scheme = SCHEMES.find((s) => trimmed.toLowerCase().startsWith(s));
  if (!scheme) throw invalid('it must start with nostr+walletconnect://');

  // WHATWG URL does not parse custom schemes the same everywhere: split by hand.
  const rest = trimmed.slice(scheme.length).replace(/^\/\//, '');
  const q = rest.indexOf('?');
  if (q < 0) throw invalid('the relay and secret parameters are missing');
  const walletPubkey = rest.slice(0, q).toLowerCase();
  const params = new URLSearchParams(rest.slice(q + 1));

  if (!HEX64.test(walletPubkey)) throw invalid('the wallet public key is not 64 hex characters');
  const secret = (params.get('secret') ?? '').toLowerCase();
  if (!HEX64.test(secret)) throw invalid('the secret is missing or not 64 hex characters');

  const relays = params
    .getAll('relay')
    .map((r) => r.trim())
    .filter(Boolean);
  if (relays.length === 0) throw invalid('no relay is given');
  for (const r of relays) {
    let u: URL;
    try {
      u = new URL(r);
    } catch {
      throw invalid(`the relay "${r}" is not a URL`);
    }
    if (u.protocol !== 'wss:' && !(opts.allowInsecureRelays && u.protocol === 'ws:')) {
      throw invalid(`the relay "${r}" must use wss://`);
    }
  }

  let clientPubkey: string;
  try {
    clientPubkey = getPublicKey(hexToBytes(secret));
  } catch {
    throw invalid('the secret is not a valid key');
  }

  const lud16 = params.get('lud16')?.trim() || null;
  return { walletPubkey, relays: [...new Set(relays)], secret, clientPubkey, lud16 };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
