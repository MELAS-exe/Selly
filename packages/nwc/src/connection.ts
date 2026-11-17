import {
  Nip47Error,
  Nip47TimeoutError,
  type Nip47Transaction,
  Nip47WalletError,
  NWCClient,
} from '@getalby/sdk/nwc';
import { checkInvoice, type LightningNetwork } from './bolt11';
import { NwcError } from './errors';
import type { ParsedNwcUri } from './uri';

/** Timeouts of architecture.md section 7.1. */
export interface NwcTimeouts {
  makeInvoiceMs: number;
  lookupInvoiceMs: number;
  getInfoMs: number;
}
export const DEFAULT_TIMEOUTS: NwcTimeouts = {
  makeInvoiceMs: 10_000,
  lookupInvoiceMs: 8_000,
  getInfoMs: 8_000,
};

export interface WalletInfo {
  /** Methods this connection may call, from get_info. */
  methods: string[];
  /** Notification types this connection receives. */
  notifications: string[];
  encryptions: string[];
  alias: string | null;
  network: string | null;
}

export interface CreatedInvoice {
  bolt11: string;
  paymentHash: string;
  amountMsat: number;
  expiresAt: Date;
}

export interface InvoiceState {
  /** False when the wallet does not know this invoice. */
  found: boolean;
  settled: boolean;
  preimage?: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new NwcError('NWC_TIMEOUT', `The wallet did not answer ${what} within ${ms / 1000} s.`),
          ),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

const toNwcError = (err: unknown, what: string): NwcError => {
  if (err instanceof NwcError) return err;
  if (err instanceof Nip47WalletError)
    return new NwcError('NWC_WALLET_ERROR', `The wallet refused ${what}: ${err.message}`, err.code);
  if (err instanceof Nip47TimeoutError)
    return new NwcError('NWC_TIMEOUT', `The wallet did not answer ${what}.`);
  if (err instanceof Nip47Error)
    return new NwcError(
      'NWC_TIMEOUT',
      `Could not reach the wallet for ${what}: ${err.message}`,
      err.code,
    );
  return new NwcError(
    'NWC_TIMEOUT',
    `Could not reach the wallet for ${what}: ${(err as Error)?.message ?? String(err)}`,
  );
};

const isSettled = (tx: Nip47Transaction) =>
  tx.state === 'settled' || (!tx.state && !!tx.settled_at && !!tx.preimage);

/**
 * One NWC connection (one wallet, one client key). Wraps the Alby SDK client with the timeouts, error codes and
 * invoice checks Selly needs. Create one per connection and reuse it; call close() when done.
 */
export class NwcConnection {
  private readonly client: NWCClient;

  constructor(
    readonly uri: ParsedNwcUri,
    private readonly opts: {
      network: LightningNetwork;
      timeouts?: Partial<NwcTimeouts>;
      now?: () => Date;
    } = { network: 'mainnet' },
  ) {
    this.client = new NWCClient({
      relayUrls: uri.relays,
      walletPubkey: uri.walletPubkey,
      secret: uri.secret,
    });
  }

  private get t(): NwcTimeouts {
    return { ...DEFAULT_TIMEOUTS, ...this.opts.timeouts };
  }
  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** Reads the wallet's info event (encryption, notifications) and get_info for this connection's own methods. */
  async info(): Promise<WalletInfo> {
    try {
      const service = await withTimeout(
        this.client.getWalletServiceInfo(),
        this.t.getInfoMs,
        'the info request',
      );
      const info = await withTimeout(this.client.getInfo(), this.t.getInfoMs, 'get_info');
      return {
        methods: info.methods ?? [],
        notifications: info.notifications ?? service.notifications ?? [],
        encryptions: service.encryptions,
        alias: info.alias || null,
        network: info.network || null,
      };
    } catch (err) {
      throw toNwcError(err, 'get_info');
    }
  }

  async balanceMsat(): Promise<number> {
    try {
      const b = await withTimeout(this.client.getBalance(), this.t.getInfoMs, 'get_balance');
      return b.balance;
    } catch (err) {
      throw toNwcError(err, 'get_balance');
    }
  }

  /** make_invoice, then a local decode: amount, hash, network and expiry must match the request. */
  async makeInvoice(req: {
    amountMsat: number;
    description: string;
    expirySeconds: number;
  }): Promise<CreatedInvoice> {
    if (
      !Number.isSafeInteger(req.amountMsat) ||
      req.amountMsat <= 0 ||
      req.amountMsat % 1000 !== 0
    ) {
      throw new Error('amountMsat must be a positive whole number of sats');
    }
    let tx: Nip47Transaction;
    try {
      tx = await withTimeout(
        this.client.makeInvoice({
          amount: req.amountMsat,
          description: req.description,
          expiry: req.expirySeconds,
        }),
        this.t.makeInvoiceMs,
        'make_invoice',
      );
    } catch (err) {
      throw toNwcError(err, 'make_invoice');
    }
    const decoded = checkInvoice(tx.invoice, {
      amountMsat: req.amountMsat,
      paymentHash: tx.payment_hash,
      maxExpirySeconds: req.expirySeconds,
      network: this.opts.network,
      now: this.now(),
    });
    return {
      bolt11: tx.invoice,
      paymentHash: decoded.paymentHash,
      amountMsat: decoded.amountMsat,
      expiresAt: decoded.expiresAt,
    };
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceState> {
    try {
      const tx = await withTimeout(
        this.client.lookupInvoice({ payment_hash: paymentHash }),
        this.t.lookupInvoiceMs,
        'lookup_invoice',
      );
      if (tx.payment_hash && tx.payment_hash.toLowerCase() !== paymentHash.toLowerCase()) {
        throw new NwcError('NWC_BAD_INVOICE', 'The wallet answered about another invoice.');
      }
      return isSettled(tx)
        ? { found: true, settled: true, ...(tx.preimage ? { preimage: tx.preimage } : {}) }
        : { found: true, settled: false };
    } catch (err) {
      if (err instanceof Nip47WalletError && err.code === 'NOT_FOUND')
        return { found: false, settled: false };
      throw toNwcError(err, 'lookup_invoice');
    }
  }

  /** Calls `onPaid(paymentHash)` for each payment_received notification. Returns the unsubscribe function. */
  async onPaymentReceived(onPaid: (paymentHash: string) => void): Promise<() => void> {
    try {
      return await withTimeout(
        this.client.subscribeNotifications(
          (n) => {
            if (n.notification_type === 'payment_received' && n.notification.payment_hash)
              onPaid(n.notification.payment_hash.toLowerCase());
          },
          ['payment_received'],
        ),
        this.t.getInfoMs,
        'the notification subscription',
      );
    } catch (err) {
      throw toNwcError(err, 'notifications');
    }
  }

  close() {
    this.client.close();
  }
}
