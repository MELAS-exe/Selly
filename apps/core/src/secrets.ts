import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for credentials (NWC URIs, later other tokens): AES-256-GCM under key-encryption keys from
 * SECRETS_KEK_V1, SECRETS_KEK_V2, ... The newest version encrypts; every configured version decrypts, which lets
 * keys rotate. `aad` binds a ciphertext to its owner: a URI copied onto another vendor's row will not decrypt.
 * Layout: 12-byte IV | 16-byte tag | ciphertext.
 */
export class Keyring {
  private constructor(
    private readonly keys: Map<number, Buffer>,
    readonly currentVersion: number,
  ) {}

  /** Reads SECRETS_KEK_V<n> (base64, 32 bytes). Returns null when none is set. */
  static fromEnv(env: NodeJS.ProcessEnv): Keyring | null {
    const keys = new Map<number, Buffer>();
    for (const [name, value] of Object.entries(env)) {
      const m = /^SECRETS_KEK_V(\d+)$/.exec(name);
      if (!m || !value) continue;
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32)
        throw new Error(`${name} must be 32 bytes, base64-encoded (it is ${key.length} bytes).`);
      keys.set(Number(m[1]), key);
    }
    if (keys.size === 0) return null;
    return new Keyring(keys, Math.max(...keys.keys()));
  }

  static forTests(): Keyring {
    return new Keyring(new Map([[1, randomBytes(32)]]), 1);
  }

  encrypt(plaintext: string, aad: string): { ciphertext: Buffer; keyVersion: number } {
    const key = this.keys.get(this.currentVersion) as Buffer;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
      keyVersion: this.currentVersion,
    };
  }

  decrypt(ciphertext: Buffer, keyVersion: number, aad: string): string {
    const key = this.keys.get(keyVersion);
    if (!key) throw new Error(`No key for version ${keyVersion}: set SECRETS_KEK_V${keyVersion}.`);
    const decipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(ciphertext.subarray(12, 28));
    return Buffer.concat([decipher.update(ciphertext.subarray(28)), decipher.final()]).toString(
      'utf8',
    );
  }
}

export const walletAad = (row: { owner: string; vendorId: string | null }) =>
  `wallet_connection:${row.owner}:${row.vendorId ?? 'platform'}`;
