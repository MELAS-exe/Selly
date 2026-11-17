import fc from 'fast-check';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { describe, expect, it } from 'vitest';
import { eventTemplate, verifyAuthEvent } from './index';

const URL = 'https://app.selly.example/api/v1/auth/nostr/sessions';
const CHALLENGE = 'a'.repeat(64);
const NOW = 1_795_000_000;
const sk = generateSecretKey();
const sign = (over: Partial<ReturnType<typeof eventTemplate>> = {}) =>
  finalizeEvent(
    { ...eventTemplate({ url: URL, method: 'POST', challenge: CHALLENGE, now: NOW }), ...over },
    sk,
  );
const expected = { url: URL, method: 'POST', challenge: CHALLENGE, now: NOW };

describe('verifyAuthEvent', () => {
  it('accepts a correctly signed event and returns its key', () => {
    expect(verifyAuthEvent(sign(), expected)).toEqual({ ok: true, pubkey: getPublicKey(sk) });
  });

  it('refuses each way an event can be wrong', () => {
    const e = sign();
    expect(verifyAuthEvent({ ...e, sig: 'f'.repeat(128) }, expected)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyAuthEvent({ ...e, content: 'changed' }, expected)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyAuthEvent(sign({ kind: 1 }), expected)).toEqual({
      ok: false,
      reason: 'wrong_kind',
    });
    expect(
      verifyAuthEvent(
        sign({
          tags: [
            ['u', `${URL}x`],
            ['method', 'POST'],
            ['challenge', CHALLENGE],
          ],
        }),
        expected,
      ),
    ).toEqual({ ok: false, reason: 'wrong_url' });
    expect(
      verifyAuthEvent(
        sign({
          tags: [
            ['u', URL],
            ['method', 'GET'],
            ['challenge', CHALLENGE],
          ],
        }),
        expected,
      ),
    ).toEqual({ ok: false, reason: 'wrong_method' });
    expect(
      verifyAuthEvent(
        sign({
          tags: [
            ['u', URL],
            ['method', 'POST'],
          ],
        }),
        expected,
      ),
    ).toEqual({ ok: false, reason: 'wrong_challenge' });
    expect(verifyAuthEvent(null, expected)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAuthEvent({ ...e, pubkey: 'npub1xyz' }, expected)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  // P7 (architecture.md section 13), the event half: never accepted with a created_at more than 60 seconds off,
  // whatever the offset; always accepted within 60 seconds. The single-use half is tested in core.
  it('P7: accepts only events within 60 seconds of now', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), (offset) => {
        const res = verifyAuthEvent(sign({ created_at: NOW + offset }), expected);
        expect(res.ok).toBe(Math.abs(offset) <= 60);
      }),
      { numRuns: 60 },
    );
  });

  it('P7: accepts only the exact URL, method and challenge it was issued for', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom('url', 'method', 'challenge'),
        (noise, field) => {
          const exp = {
            ...expected,
            ...(field === 'url' ? { url: URL + noise } : {}),
            ...(field === 'method' ? { method: `POST${noise}` } : {}),
            ...(field === 'challenge' ? { challenge: CHALLENGE + noise } : {}),
          };
          expect(verifyAuthEvent(sign(), exp).ok).toBe(false);
        },
      ),
      { numRuns: 60 },
    );
  });
});
