// The browser half of Nostr sign-in (architecture.md 5.3.2). A signer turns the server's event template into a
// signed event. Two kinds so far: a NIP-07 browser extension, and a key Selly creates in the browser and keeps on the
// device encrypted with a passphrase (NIP-49). Amber (NIP-55) and bunkers (NIP-46) come later.
//
// nostr-tools is loaded on demand, so the pages that never sign in do not pay for it.
import type { SignedNostrEvent, UnsignedNostrEvent } from './vendor-types';

export interface Signer {
  sign(template: UnsignedNostrEvent): Promise<SignedNostrEvent>;
}

/** The browser extension API (NIP-07). */
interface Nip07 {
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
}

declare global {
  interface Window {
    nostr?: Partial<Nip07>;
  }
}

/** A problem the vendor can fix (wrong passphrase, a declined request). Its message is shown as is. */
export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyError';
  }
}

export const STORAGE_KEY = 'selly:nostr-key';
export const MIN_PASSPHRASE = 8;

export const hasExtension = () => typeof window !== 'undefined' && !!window.nostr?.signEvent;

export function extensionSigner(): Signer {
  return {
    async sign(template) {
      const nostr = window.nostr;
      if (!nostr?.signEvent) throw new KeyError('No Nostr extension was found in this browser.');
      try {
        return await nostr.signEvent(template);
      } catch {
        throw new KeyError('The extension declined to sign. Approve the request and try again.');
      }
    },
  };
}

export function localKeySigner(secretKey: Uint8Array): Signer {
  return {
    async sign(template) {
      const { finalizeEvent } = await import('nostr-tools/pure');
      return finalizeEvent(template, secretKey);
    },
  };
}

export interface NewKey {
  secretKey: Uint8Array;
  /** The backup the vendor must keep. Shown once, never stored. */
  nsec: string;
  npub: string;
}

export async function createLocalKey(): Promise<NewKey> {
  const { generateSecretKey, getPublicKey } = await import('nostr-tools/pure');
  const { nsecEncode, npubEncode } = await import('nostr-tools/nip19');
  const secretKey = generateSecretKey();
  return {
    secretKey,
    nsec: nsecEncode(secretKey),
    npub: npubEncode(getPublicKey(secretKey)),
  };
}

export const storedKey = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Encrypts the key with the passphrase and keeps it on this device. Only the encrypted form is stored. */
export async function storeKey(secretKey: Uint8Array, passphrase: string): Promise<void> {
  const { encrypt } = await import('nostr-tools/nip49');
  localStorage.setItem(STORAGE_KEY, encrypt(secretKey, passphrase));
}

export async function unlockStoredKey(passphrase: string): Promise<Uint8Array> {
  const saved = storedKey();
  if (!saved) throw new KeyError('No key is saved on this device.');
  const { decrypt } = await import('nostr-tools/nip49');
  try {
    return decrypt(saved, passphrase);
  } catch {
    throw new KeyError('That passphrase does not unlock the saved key.');
  }
}

export function forgetStoredKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
}
