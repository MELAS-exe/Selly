import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkInvoice,
  checkPermissions,
  decodeInvoice,
  NwcConnection,
  NwcError,
  parseNwcUri,
} from './index';
import { encodeInvoice, FakeNwcWallet, signingHash, TestRelay } from './testkit';

const HEX = (seed: string) => bytesToHex(sha256(new TextEncoder().encode(seed)));
const WALLET = HEX('wallet');
const SECRET = HEX('secret');

describe('checkPermissions', () => {
  it('accepts a receive-only connection', () => {
    expect(checkPermissions(['make_invoice', 'lookup_invoice', 'get_info', 'get_balance'])).toEqual(
      {
        ok: true,
        receiveOnly: true,
        hasBalance: true,
      },
    );
  });
  it('refuses a missing lookup_invoice', () => {
    expect(checkPermissions(['make_invoice'])).toMatchObject({
      ok: false,
      code: 'NWC_METHODS_MISSING',
    });
  });
  it('refuses spending methods', () => {
    expect(checkPermissions(['make_invoice', 'lookup_invoice', 'pay_invoice'])).toMatchObject({
      ok: false,
      code: 'NWC_PERMISSIONS_TOO_BROAD',
      methods: ['pay_invoice'],
    });
  });
});

describe('parseNwcUri', () => {
  const uri = `nostr+walletconnect://${WALLET}?relay=wss%3A%2F%2Frelay.example&relay=wss://relay2.example&secret=${SECRET}&lud16=awa%40example.com`;

  it('parses a valid URI and derives the client key', () => {
    const p = parseNwcUri(uri);
    expect(p).toMatchObject({
      walletPubkey: WALLET,
      secret: SECRET,
      relays: ['wss://relay.example', 'wss://relay2.example'],
      lud16: 'awa@example.com',
    });
    expect(p.clientPubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires wss:// unless insecure relays are allowed', () => {
    const local = `nostr+walletconnect://${WALLET}?relay=ws://127.0.0.1:7777&secret=${SECRET}`;
    expect(() => parseNwcUri(local)).toThrow(/must use wss/);
    expect(parseNwcUri(local, { allowInsecureRelays: true }).relays).toEqual([
      'ws://127.0.0.1:7777',
    ]);
  });

  it.each([
    ['https://example.com', /nostr\+walletconnect/],
    [`nostr+walletconnect://${WALLET}`, /missing/],
    [`nostr+walletconnect://abc?relay=wss://r.example&secret=${SECRET}`, /wallet public key/],
    [`nostr+walletconnect://${WALLET}?relay=wss://r.example`, /secret/],
    [`nostr+walletconnect://${WALLET}?secret=${SECRET}`, /no relay/],
  ])('refuses %s', (bad, why) => {
    expect(() => parseNwcUri(bad)).toThrow(why);
  });

  it('never puts the secret in an error message', () => {
    try {
      parseNwcUri(`nostr+walletconnect://${WALLET}?relay=http://x.example&secret=${SECRET}`);
      expect.unreachable();
    } catch (err) {
      expect((err as NwcError).code).toBe('NWC_URI_INVALID');
      expect((err as Error).message).not.toContain(SECRET);
    }
  });
});

describe('BOLT11', () => {
  const nodeKey = randomBytes(32);
  const preimage = randomBytes(32);
  const hash = sha256(preimage);
  const now = Math.floor(Date.now() / 1000);
  const make = (over: Partial<Parameters<typeof encodeInvoice>[0]> = {}) =>
    encodeInvoice({
      amountMsat: 27_103_000,
      paymentHash: hash,
      paymentSecret: randomBytes(32),
      description: 'Awa Style commande A7K2',
      expirySeconds: 1200,
      timestamp: now,
      nodeKey,
      ...over,
    });

  it('encodes an invoice the decoder reads back, signed by the node key', () => {
    const inv = make();
    expect(inv.startsWith('lnbc271030n1')).toBe(true);
    const d = decodeInvoice(inv);
    expect(d).toMatchObject({
      amountMsat: 27_103_000,
      paymentHash: bytesToHex(hash),
      expirySeconds: 1200,
      network: 'bc',
    });
    expect(d.expiresAt.getTime()).toBe((now + 1200) * 1000);

    const { hash: msg, signature } = signingHash(inv);
    const recoveredSig = new Uint8Array([signature[64] as number, ...signature.subarray(0, 64)]);
    const pub = secp256k1.recoverPublicKey(recoveredSig, msg, { prehash: false });
    expect(bytesToHex(pub)).toBe(bytesToHex(secp256k1.getPublicKey(nodeKey)));
  });

  it('checks amount, hash, network and expiry against the request', () => {
    const expected = {
      amountMsat: 27_103_000,
      paymentHash: bytesToHex(hash),
      maxExpirySeconds: 1200,
      network: 'mainnet' as const,
      now: new Date(now * 1000),
    };
    expect(checkInvoice(make(), expected).amountMsat).toBe(27_103_000);
    expect(() => checkInvoice(make({ amountMsat: 27_102_000 }), expected)).toThrow(/amount/);
    expect(() =>
      checkInvoice(make(), { ...expected, paymentHash: bytesToHex(sha256(hash)) }),
    ).toThrow(/payment hash/);
    expect(() => checkInvoice(make({ network: 'tb' }), expected)).toThrow(/network/);
    expect(() => checkInvoice(make({ expirySeconds: 86_400 }), expected)).toThrow(/expiry/);
    expect(() => checkInvoice(make({ timestamp: now - 3600 }), expected)).toThrow(/expired/);
    expect(() => checkInvoice('lnbc1garbage', expected)).toThrow(NwcError);
  });
});

describe('NwcConnection over a relay', () => {
  let relay: TestRelay;
  let wallet: FakeNwcWallet;
  let conn: NwcConnection;
  const timeouts = { makeInvoiceMs: 3000, lookupInvoiceMs: 3000, getInfoMs: 3000 };

  beforeAll(async () => {
    relay = await TestRelay.start();
    wallet = await FakeNwcWallet.start({ relayUrl: relay.url });
    conn = new NwcConnection(parseNwcUri(wallet.uri, { allowInsecureRelays: true }), {
      network: 'mainnet',
      timeouts,
    });
  }, 30_000);
  afterAll(async () => {
    conn.close();
    wallet.close();
    await relay.stop();
  });

  it('reads the connection methods and notifications', async () => {
    const info = await conn.info();
    expect(info.methods).toEqual(['get_info', 'get_balance', 'make_invoice', 'lookup_invoice']);
    expect(info.notifications).toEqual(['payment_received']);
    expect(info.encryptions).toContain('nip44_v2');
    expect(await conn.balanceMsat()).toBe(184_200_000);
  });

  it('makes an invoice, sees it unpaid, then paid with the preimage', async () => {
    const inv = await conn.makeInvoice({
      amountMsat: 27_103_000,
      description: 'Awa Style commande A7K2',
      expirySeconds: 1200,
    });
    expect(inv.amountMsat).toBe(27_103_000);
    expect(await conn.lookupInvoice(inv.paymentHash)).toEqual({ found: true, settled: false });

    const seen: string[] = [];
    const unsub = await conn.onPaymentReceived((h) => seen.push(h));
    await wallet.pay(inv.paymentHash);
    await expect.poll(() => seen, { timeout: 3000 }).toContain(inv.paymentHash);
    unsub();

    const state = await conn.lookupInvoice(inv.paymentHash);
    expect(state.settled).toBe(true);
    expect(bytesToHex(sha256(Buffer.from(state.preimage as string, 'hex')))).toBe(inv.paymentHash);
  });

  it('reports an unknown invoice as not found', async () => {
    expect(await conn.lookupInvoice(HEX('nope'))).toEqual({ found: false, settled: false });
  });

  it.each(['amount', 'hash', 'expiry', 'network'] as const)(
    'refuses a wallet that lies about the %s',
    async (tamper) => {
      wallet.tamperNext = tamper;
      await expect(
        conn.makeInvoice({ amountMsat: 1_000, description: 't', expirySeconds: 60 }),
      ).rejects.toMatchObject({ code: 'NWC_BAD_INVOICE' });
    },
  );

  it('times out when the wallet stops answering', async () => {
    wallet.goOffline();
    const slow = new NwcConnection(parseNwcUri(wallet.uri, { allowInsecureRelays: true }), {
      network: 'mainnet',
      timeouts: { makeInvoiceMs: 800, lookupInvoiceMs: 800, getInfoMs: 800 },
    });
    try {
      await expect(
        slow.makeInvoice({ amountMsat: 1_000, description: 't', expirySeconds: 60 }),
      ).rejects.toMatchObject({ code: 'NWC_TIMEOUT' });
    } finally {
      slow.close();
      await wallet.goOnline();
    }
  });
});
