import { eventTemplate, verifyAuthEvent } from '@selly/nostr';
import { describe, expect, it } from 'vitest';
import { createLocalKey, localKeySigner } from './nostr-signers';

describe('local key signer', () => {
  it('signs the sign-in event so that core accepts it', async () => {
    const key = await createLocalKey();
    const now = Math.floor(Date.now() / 1000);
    const url = 'https://app.selly.example/api/v1/auth/nostr/sessions';
    const challenge = 'ab'.repeat(32);

    const template = eventTemplate({ url, method: 'POST', challenge, now });
    const event = await localKeySigner(key.secretKey).sign(template);

    const check = verifyAuthEvent(event, { url, method: 'POST', challenge, now });
    expect(check).toMatchObject({ ok: true });
  });

  it('is refused when the challenge is not the one asked for', async () => {
    const key = await createLocalKey();
    const now = Math.floor(Date.now() / 1000);
    const url = 'https://app.selly.example/api/v1/auth/nostr/sessions';
    const event = await localKeySigner(key.secretKey).sign(
      eventTemplate({ url, method: 'POST', challenge: 'ab'.repeat(32), now }),
    );
    expect(
      verifyAuthEvent(event, { url, method: 'POST', challenge: 'cd'.repeat(32), now }),
    ).toEqual({
      ok: false,
      reason: 'wrong_challenge',
    });
  });

  it('makes a new key each time, with a backup that names it', async () => {
    const a = await createLocalKey();
    const b = await createLocalKey();
    expect(a.nsec).toMatch(/^nsec1/);
    expect(a.npub).toMatch(/^npub1/);
    expect(a.nsec).not.toBe(b.nsec);
  });
});
