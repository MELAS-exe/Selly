// Invoices on each vendor's own wallet through NWC (architecture.md sections 3.6, 7.3 and 7.5).
// - One NwcConnection per wallet connection, cached, closed after 10 idle minutes.
// - A circuit breaker per connection: 5 failures in 2 minutes open it for 60 seconds and mark the wallet degraded.
//   The next success marks it active again. Both changes are audited and sent to the agent.
// - At most one request per NWC_MIN_INTERVAL_MS per wallet.
// - payment_received notifications only trigger a lookup (ADR-06); onPaymentNotice does that.
// Runs as a single instance today. With several core instances, elect one with a PostgreSQL advisory lock.
import { core } from '@selly/db';
import { and, eq, ne } from '@selly/db/orm';
import { NwcConnection, NwcError, parseNwcUri } from '@selly/nwc';
import type { Context } from '../../context';
import { walletAad } from '../../secrets';
import { audit, publishEvent } from '../events/outbox';
import { nwcOptions, requireKeyring } from '../wallet/service';
import type {
  InvoiceGateway,
  InvoiceLookup,
  InvoiceProvider,
  MadeInvoice,
  MakeInvoiceRequest,
} from './provider';

const { walletConnections: wc } = core;
type Row = typeof wc.$inferSelect;
type Deps = Pick<Context, 'config' | 'db' | 'now' | 'keyring' | 'log'>;

const FAILURE_WINDOW_MS = 2 * 60_000;
const FAILURES_TO_OPEN = 5;
const OPEN_FOR_MS = 60_000;
const IDLE_MS = 10 * 60_000;
const MAX_CLIENTS = 500;

/** Thrown when a vendor has no usable wallet. Orders turn it into PAYMENT_UNAVAILABLE. */
export class WalletUnavailableError extends Error {}

export class NwcGateway implements InvoiceGateway {
  private readonly clients = new Map<string, { conn: NwcConnection; lastUsed: number }>();
  private readonly breakers = new Map<string, { failures: number[]; openUntil: number }>();
  private readonly nextSlot = new Map<string, number>();
  private readonly subscriptions = new Map<string, () => void>();

  constructor(
    private readonly deps: Deps,
    private readonly onPaymentNotice: (n: {
      vendorId: string;
      walletConnectionId: string;
      paymentHash: string;
    }) => void = () => {},
    /** A payment on the platform wallet: a subscription invoice, confirmed by a lookup as well. */
    private readonly onPlatformPaymentNotice: (n: {
      walletConnectionId: string;
      paymentHash: string;
    }) => void = () => {},
  ) {
    requireKeyring(deps.keyring);
  }

  forVendor(vendorId: string): InvoiceProvider {
    return {
      makeInvoice: (req) => this.makeInvoice({ ...req, vendorId }),
      lookupInvoice: (req) => this.lookupInvoice({ ...req, vendorId }),
    };
  }

  /** The platform's receive-only wallet, for subscription invoices (architecture.md section 3.7). */
  forPlatform(): InvoiceProvider {
    return {
      makeInvoice: async (req) => {
        const [row] = await this.deps.db
          .select()
          .from(wc)
          .where(and(eq(wc.owner, 'platform'), ne(wc.status, 'revoked')));
        if (!row?.uriCiphertext)
          throw new WalletUnavailableError(
            'No platform wallet is linked (cli wallet:link --platform).',
          );
        return this.made(row, req);
      },
      lookupInvoice: async (req) => {
        if (!req.walletConnectionId) return { settled: false };
        const [row] = await this.deps.db.select().from(wc).where(eq(wc.id, req.walletConnectionId));
        if (!row || row.owner !== 'platform')
          throw new Error('wallet connection is not the platform wallet');
        return this.lookupOn(row, req.paymentHash);
      },
    };
  }

  async makeInvoice(req: MakeInvoiceRequest): Promise<MadeInvoice> {
    const [row] = await this.deps.db
      .select()
      .from(wc)
      .where(and(eq(wc.owner, 'vendor'), eq(wc.vendorId, req.vendorId), ne(wc.status, 'revoked')));
    if (!row?.uriCiphertext) throw new WalletUnavailableError('This vendor has no linked wallet.');
    return this.made(row, req);
  }

  private async made(row: Row, req: MakeInvoiceRequest): Promise<MadeInvoice> {
    const made = await this.call(row, (c) =>
      c.makeInvoice({
        amountMsat: req.amountMsat,
        description: req.description,
        expirySeconds: req.expirySeconds,
      }),
    );
    return {
      source: 'nwc',
      walletConnectionId: row.id,
      bolt11: made.bolt11,
      paymentHash: made.paymentHash,
      amountMsat: made.amountMsat,
      expiresAt: made.expiresAt,
    };
  }

  async lookupInvoice(req: {
    vendorId: string;
    walletConnectionId: string | null;
    paymentHash: string;
  }): Promise<InvoiceLookup> {
    if (!req.walletConnectionId) return { settled: false };
    const [row] = await this.deps.db.select().from(wc).where(eq(wc.id, req.walletConnectionId));
    if (!row || row.vendorId !== req.vendorId)
      throw new Error('wallet connection does not belong to this vendor');
    return this.lookupOn(row, req.paymentHash);
  }

  private async lookupOn(row: Row, paymentHash: string): Promise<InvoiceLookup> {
    // An unlinked wallet cannot be asked any more. Its open invoices simply expire.
    if (row.status === 'revoked' || !row.uriCiphertext) return { settled: false };
    const state = await this.call(row, (c) => c.lookupInvoice(paymentHash));
    return state.settled
      ? { settled: true, ...(state.preimage ? { preimage: state.preimage } : {}) }
      : { settled: false };
  }

  /**
   * Subscribe to payment notifications of every live wallet that offers them (vendors' and the platform's), and drop
   * wallets that were unlinked. Called at start and then every minute, so a wallet linked from the CLI is picked up
   * without a restart.
   */
  async refresh(): Promise<void> {
    const rows = await this.deps.db.select().from(wc).where(ne(wc.status, 'revoked'));
    const live = new Set(rows.map((r) => r.id));

    for (const [id, unsub] of this.subscriptions) {
      if (!live.has(id)) {
        unsub();
        this.subscriptions.delete(id);
      }
    }
    for (const [id, c] of this.clients) {
      if (!live.has(id) || (Date.now() - c.lastUsed > IDLE_MS && !this.subscriptions.has(id))) {
        c.conn.close();
        this.clients.delete(id);
      }
    }
    for (const row of rows) {
      if (!row.notifications || this.subscriptions.has(row.id) || !row.uriCiphertext) continue;
      const vendorId = row.vendorId;
      try {
        const unsub = await this.client(row).onPaymentReceived((paymentHash) =>
          vendorId
            ? this.onPaymentNotice({ vendorId, walletConnectionId: row.id, paymentHash })
            : this.onPlatformPaymentNotice({ walletConnectionId: row.id, paymentHash }),
        );
        this.subscriptions.set(row.id, unsub);
      } catch (err) {
        this.deps.log.warn(
          { err: String(err), walletConnectionId: row.id },
          'could not subscribe to wallet notifications',
        );
      }
    }
  }

  /** Stops listening for payments (this process is no longer the job leader). Invoices still work. */
  unsubscribeAll() {
    for (const unsub of this.subscriptions.values()) unsub();
    this.subscriptions.clear();
  }

  close() {
    this.unsubscribeAll();
    for (const c of this.clients.values()) c.conn.close();
    this.clients.clear();
  }

  // ------------------------------------------------------------------------------------------------ internals

  private client(row: Row): NwcConnection {
    const cached = this.clients.get(row.id);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.conn;
    }
    const keyring = requireKeyring(this.deps.keyring);
    const uri = keyring.decrypt(row.uriCiphertext as Buffer, row.keyVersion ?? 1, walletAad(row));
    const conn = new NwcConnection(
      parseNwcUri(uri, { allowInsecureRelays: this.deps.config.NWC_ALLOW_INSECURE_RELAYS }),
      nwcOptions(this.deps.config),
    );
    if (this.clients.size >= MAX_CLIENTS) this.evictOne();
    this.clients.set(row.id, { conn, lastUsed: Date.now() });
    return conn;
  }

  private evictOne() {
    let oldest: [string, number] | null = null;
    for (const [id, c] of this.clients) {
      if (this.subscriptions.has(id)) continue;
      if (!oldest || c.lastUsed < oldest[1]) oldest = [id, c.lastUsed];
    }
    if (oldest) {
      this.clients.get(oldest[0])?.conn.close();
      this.clients.delete(oldest[0]);
    }
  }

  private async throttle(id: string) {
    const gap = this.deps.config.NWC_MIN_INTERVAL_MS;
    if (gap <= 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(id) ?? 0);
    this.nextSlot.set(id, slot + gap);
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  private async call<T>(row: Row, fn: (c: NwcConnection) => Promise<T>): Promise<T> {
    const b = this.breakers.get(row.id);
    if (b && b.openUntil > Date.now()) {
      throw new WalletUnavailableError(
        `Wallet ${row.id} is failing; retrying after ${new Date(b.openUntil).toISOString()}.`,
      );
    }
    await this.throttle(row.id);
    try {
      const result = await fn(this.client(row));
      await this.succeeded(row);
      return result;
    } catch (err) {
      if (err instanceof NwcError) await this.failed(row, err);
      throw err;
    }
  }

  private async succeeded(row: Row) {
    this.breakers.delete(row.id);
    if (row.status !== 'degraded') return;
    const now = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      const restored = await tx
        .update(wc)
        .set({ status: 'active', lastError: null, lastOkAt: now })
        .where(and(eq(wc.id, row.id), eq(wc.status, 'degraded')))
        .returning({ id: wc.id });
      if (restored.length === 0 || !row.vendorId) return;
      await audit(tx, { actor: 'system', action: 'wallet.restored', target: row.vendorId });
      await publishEvent(tx, {
        type: 'wallet.restored',
        vendorId: row.vendorId,
        key: row.vendorId,
        data: {},
        now,
      });
    });
    row.status = 'active';
    this.deps.log.info({ walletConnectionId: row.id }, 'wallet restored');
  }

  private async failed(row: Row, err: NwcError) {
    const now = Date.now();
    const b = this.breakers.get(row.id) ?? { failures: [], openUntil: 0 };
    b.failures = [...b.failures.filter((t) => now - t < FAILURE_WINDOW_MS), now];
    this.breakers.set(row.id, b);
    this.deps.log.warn(
      { walletConnectionId: row.id, code: err.code, failures: b.failures.length },
      'wallet request failed',
    );
    if (b.failures.length < FAILURES_TO_OPEN) return;

    b.openUntil = now + OPEN_FOR_MS;
    b.failures = [];
    const at = this.deps.now();
    await this.deps.db.transaction(async (tx) => {
      const degraded = await tx
        .update(wc)
        .set({ status: 'degraded', lastError: `${err.code}: ${err.message}`.slice(0, 300) })
        .where(and(eq(wc.id, row.id), eq(wc.status, 'active')))
        .returning({ id: wc.id });
      if (degraded.length === 0 || !row.vendorId) return;
      await audit(tx, {
        actor: 'system',
        action: 'wallet.degraded',
        target: row.vendorId,
        details: { code: err.code },
      });
      await publishEvent(tx, {
        type: 'wallet.degraded',
        vendorId: row.vendorId,
        key: row.vendorId,
        data: { reason: err.code },
        now: at,
      });
    });
    row.status = 'degraded';
  }
}
