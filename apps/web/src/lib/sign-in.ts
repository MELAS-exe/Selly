import { api } from './browser-api';
import type { Signer } from './nostr-signers';
import type { ChallengeResponse, NostrSessionResponse } from './vendor-types';

/** What the device list shows ("Windows, Chrome"). Kept short: core accepts 60 characters. */
function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web browser';
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac/i.test(ua)
          ? 'Mac'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'browser';
  return `${os}, ${browser}`.slice(0, 60);
}

/**
 * The whole exchange: ask core for a one-time challenge, have the signer sign the event it describes, and send the
 * result back. Core sets the session cookie. Do any slow work (unlocking a key) before calling this: the signed event
 * is only accepted for 60 seconds.
 */
export async function signIn(signer: Signer): Promise<NostrSessionResponse> {
  const challenge = await api<ChallengeResponse>('/auth/nostr/challenges', {
    method: 'POST',
    body: { purpose: 'sign_in' },
  });
  const event = await signer.sign(challenge.event_template);
  return api<NostrSessionResponse>('/auth/nostr/sessions', {
    method: 'POST',
    body: { challenge_id: challenge.challenge_id, event, device_label: deviceLabel() },
  });
}
