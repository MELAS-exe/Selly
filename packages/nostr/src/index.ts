// Nostr sign-in for Selly (architecture.md section 5.3.2): the server half. The vendor signs a one-time
// challenge in a NIP-98 event (kind 27235); the server checks it here. The browser half (signer adapters for NIP-07,
// NIP-46, NIP-55 and a local key) is Dev 1's, in src/browser.
import { type Event, verifyEvent } from 'nostr-tools/pure';

export const LOGIN_EVENT_KIND = 27235; // NIP-98 HTTP auth
export const MAX_CLOCK_SKEW_SECONDS = 60;
export const CHALLENGE_TTL_SECONDS = 300;
export const STEP_UP_TTL_SECONDS = 600;
export const MAX_KEYS_PER_VENDOR = 3;

export type NostrEvent = Event;

export interface AuthExpectation {
  /** The absolute URL the event must name in its `u` tag. */
  url: string;
  /** The HTTP method the event must name in its `method` tag. */
  method: string;
  /** The challenge (hex) the event must carry in its `challenge` tag. */
  challenge: string;
  /** Unix seconds. */
  now: number;
}

export type AuthFailure =
  | 'malformed'
  | 'bad_signature'
  | 'wrong_kind'
  | 'stale'
  | 'wrong_url'
  | 'wrong_method'
  | 'wrong_challenge';

export type AuthCheck = { ok: true; pubkey: string } | { ok: false; reason: AuthFailure };

const HEX64 = /^[0-9a-f]{64}$/;
const tag = (e: Event, name: string) => e.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1];

/** The event a signer must complete for a challenge. */
export function eventTemplate(e: { url: string; method: string; challenge: string; now: number }) {
  return {
    kind: LOGIN_EVENT_KIND,
    created_at: e.now,
    tags: [
      ['u', e.url],
      ['method', e.method],
      ['challenge', e.challenge],
    ],
    content: '',
  };
}

/**
 * Checks a signed sign-in event: shape, Schnorr signature and id, kind 27235, created_at within 60 seconds,
 * the `u` and `method` tags, and the challenge. It does not check that the challenge is unused: that is the
 * caller's single-use claim in the database.
 */
export function verifyAuthEvent(input: unknown, expected: AuthExpectation): AuthCheck {
  const e = input as Event;
  if (
    !e ||
    typeof e !== 'object' ||
    typeof e.id !== 'string' ||
    typeof e.pubkey !== 'string' ||
    !HEX64.test(e.pubkey) ||
    typeof e.sig !== 'string' ||
    typeof e.kind !== 'number' ||
    !Number.isInteger(e.created_at) ||
    !Array.isArray(e.tags) ||
    typeof e.content !== 'string'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  let valid = false;
  try {
    // Rebuilt from its fields: nostr-tools caches a successful check on the object under a symbol, which a spread
    // copy would carry over. JSON bodies never have it, but the check must not depend on where the object came from.
    valid = verifyEvent({
      id: e.id,
      pubkey: e.pubkey,
      created_at: e.created_at,
      kind: e.kind,
      tags: e.tags,
      content: e.content,
      sig: e.sig,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (e.kind !== LOGIN_EVENT_KIND) return { ok: false, reason: 'wrong_kind' };
  if (Math.abs(e.created_at - expected.now) > MAX_CLOCK_SKEW_SECONDS)
    return { ok: false, reason: 'stale' };
  if (tag(e, 'u') !== expected.url) return { ok: false, reason: 'wrong_url' };
  if ((tag(e, 'method') ?? '').toUpperCase() !== expected.method.toUpperCase())
    return { ok: false, reason: 'wrong_method' };
  if (tag(e, 'challenge') !== expected.challenge) return { ok: false, reason: 'wrong_challenge' };
  return { ok: true, pubkey: e.pubkey };
}
