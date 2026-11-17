// Client-initiated wallet pairing, "Nostr Wallet Auth" (NIP-47 proposal; architecture.md F2 and section 5.3.4).
// 1. Core makes a connection key and shows nostr+walletauth://<client pubkey>?relay=...&request_methods=...
// 2. The vendor opens it in a wallet that supports it (Alby Go, Alby Hub, ...), which creates a receive-only
//    connection for that key and publishes its info event (kind 13194) tagged with the client pubkey.
// 3. The watcher sees that event, builds the usual nostr+walletconnect:// URI from the wallet pubkey and our secret,
//    and runs the same five checks as a pasted URI (linkWallet). The secret never left core.
import { core } from '@selly/db';
import { and, eq, inArray, lt } from '@selly/db/orm';
import type { Filter } from 'nostr-tools/filter';
import { SimplePool, type SubCloser } from 'nostr-tools/pool';
import { type Event, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { notifyVendor } from '../events/notifications';
import { audit } from '../events/outbox';
import { linkWallet, liveWallet, requireKeyring } from './service';

const { walletPairings: wp } = core;
type Pairing = typeof wp.$inferSelect;

export const PAIRING_TTL_MS = 10 * 60_000;
/** What Selly asks the wallet for: receive only (architecture.md section 3.6). */
export const PAIRING_METHODS = ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice'];
const aad = (vendorId: string) => `wallet_pairing:${vendorId}`;

export function walletAuthUri(input: {
  clientPubkey: string;
  relays: string[];
  returnTo: string;
}): string {
  const q = new URLSearchParams({
    request_methods: PAIRING_METHODS.join(' '),
    notification_types: 'payment_received',
    name: 'Selly',
    return_to: input.returnTo,
  });
  for (const r of input.relays) q.append('relay', r);
  // Wallets split on spaces; URLSearchParams writes them as "+".
  return `nostr+walletauth://${input.clientPubkey}?${q.toString().replace(/\+/g, '%20')}`;
}

/** A new pairing for the vendor. An earlier pending one is dropped: only the latest link works. */
export async function startPairing(ctx: Context, vendorId: string) {
  const keyring = requireKeyring(ctx.keyring);
  const relays = ctx.config.NWC_PAIRING_RELAYS.split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  const secret = Buffer.from(generateSecretKey()).toString('hex');
  const clientPubkey = getPublicKey(Buffer.from(secret, 'hex'));
  const { ciphertext, keyVersion } = keyring.encrypt(secret, aad(vendorId));
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  const [row] = await ctx.db.transaction(async (tx) => {
    await tx
      .update(wp)
      .set({ status: 'expired', secretCiphertext: null, completedAt: now })
      .where(and(eq(wp.vendorId, vendorId), eq(wp.status, 'pending')));
    return tx
      .insert(wp)
      .values({
        vendorId,
        clientPubkey,
        secretCiphertext: ciphertext,
        keyVersion,
        relays,
        expiresAt,
        createdAt: now,
      })
      .returning();
  });
  const pairing = row as Pairing;
  return {
    pairing_id: pairing.id,
    open_uri: walletAuthUri({
      clientPubkey,
      relays,
      returnTo: `${ctx.config.APP_BASE_URL}/dashboard/wallet`,
    }),
    expires_at: iso(expiresAt) as string,
  };
}

/**
 * Listens on the pairing relays for wallets announcing a pending pairing. One subscription for every pending
 * pairing, renewed when the set changes. Runs in each core process; the conditional update on the pairing row means
 * only one of them links it.
 */
export class PairingWatcher {
  private pool = new SimplePool();
  private sub: SubCloser | null = null;
  private watched = '';
  private readonly busy = new Set<string>();

  constructor(private readonly ctx: Context) {}

  async refresh() {
    const now = this.ctx.now();
    await this.ctx.db
      .update(wp)
      .set({ status: 'expired', secretCiphertext: null, completedAt: now })
      .where(and(eq(wp.status, 'pending'), lt(wp.expiresAt, now)));
    const pending = await this.ctx.db
      .select({ clientPubkey: wp.clientPubkey, relays: wp.relays })
      .from(wp)
      .where(eq(wp.status, 'pending'));
    const pubkeys = pending.map((p) => p.clientPubkey).sort();
    const relays = [...new Set(pending.flatMap((p) => p.relays))].sort();
    const key = `${relays.join(',')}|${pubkeys.join(',')}`;
    if (key === this.watched) return;
    this.sub?.close();
    this.sub = null;
    this.watched = key;
    if (pubkeys.length === 0) return;
    const filter: Filter = { kinds: [13194], '#p': pubkeys };
    this.sub = this.pool.subscribeMany(relays, filter, {
      onevent: (e) => {
        void this.onEvent(e).catch((err) =>
          this.ctx.log.warn({ err: String(err) }, 'wallet pairing failed'),
        );
      },
    });
  }

  private async onEvent(e: Event) {
    if (e.kind !== 13194 || !verifyEvent(e)) return;
    const clientPubkey = e.tags.find((t) => t[0] === 'p')?.[1];
    if (!clientPubkey || this.busy.has(clientPubkey)) return;
    this.busy.add(clientPubkey);
    try {
      const [p] = await this.ctx.db
        .select()
        .from(wp)
        .where(and(eq(wp.clientPubkey, clientPubkey), eq(wp.status, 'pending')));
      if (!p?.secretCiphertext || p.expiresAt <= this.ctx.now()) return;
      await this.complete(p, e.pubkey);
    } finally {
      this.busy.delete(clientPubkey);
    }
  }

  private async complete(p: Pairing, walletPubkey: string) {
    const keyring = requireKeyring(this.ctx.keyring);
    const secret = keyring.decrypt(p.secretCiphertext as Buffer, p.keyVersion, aad(p.vendorId));
    const q = new URLSearchParams();
    for (const r of p.relays) q.append('relay', r);
    q.set('secret', secret);
    const uri = `nostr+walletconnect://${walletPubkey}?${q.toString()}`;
    const now = this.ctx.now();
    let result: {
      status: 'linked' | 'failed';
      error: string | null;
      walletConnectionId: string | null;
    };
    try {
      await linkWallet(this.ctx, {
        owner: 'vendor',
        vendorId: p.vendorId,
        uri,
        actor: `vendor:${p.vendorId}`,
      });
      const row = await liveWallet(this.ctx.db, { owner: 'vendor', vendorId: p.vendorId });
      result = { status: 'linked', error: null, walletConnectionId: row?.id ?? null };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'NWC_WALLET_ERROR';
      result = { status: 'failed', error: code, walletConnectionId: null };
    }
    await this.ctx.db.transaction(async (tx) => {
      const done = await tx
        .update(wp)
        .set({ ...result, secretCiphertext: null, completedAt: now })
        .where(and(eq(wp.id, p.id), inArray(wp.status, ['pending'])))
        .returning({ id: wp.id });
      if (done.length === 0) return;
      await audit(tx, {
        actor: `vendor:${p.vendorId}`,
        action: `wallet.pairing_${result.status}`,
        target: p.vendorId,
        details: { wallet_pubkey: walletPubkey, ...(result.error ? { error: result.error } : {}) },
      });
      await notifyVendor(tx, {
        vendorId: p.vendorId,
        type: 'wallet.paired',
        data: { pairing_id: p.id, status: result.status, error: result.error },
        now,
      });
    });
  }

  close() {
    this.sub?.close();
    this.sub = null;
    this.pool.destroy();
    this.pool = new SimplePool();
    this.watched = '';
  }
}
