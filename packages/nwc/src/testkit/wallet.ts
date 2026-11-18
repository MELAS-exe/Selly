// A fake NWC wallet service for tests. It speaks real NIP-47 (encrypted requests and responses, info event,
// notifications) over a relay, using the Alby SDK's NWCWalletService, and keeps its invoices in memory.
import { randomBytes } from 'node:crypto';
import {
  type Nip47Method,
  type Nip47NotificationType,
  type Nip47Transaction,
  NWCWalletService,
  NWCWalletServiceKeyPair,
} from '@getalby/sdk/nwc';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import { encodeInvoice } from './bolt11';

export interface FakeWalletOptions {
  relayUrl: string;
  /** Methods this connection allows. Default: receive-only. */
  methods?: Nip47Method[];
  notifications?: boolean;
  balanceMsat?: number;
  network?: 'bc' | 'tb' | 'tbs' | 'bcrt';
  /**
   * Nostr Wallet Auth: the app made the client key and only gave its public half. The wallet serves that key and
   * tags its info event with it, so the app can find the wallet.
   */
  clientPubkey?: string;
  /** Fixed keys (hex), so a long-running dev wallet keeps the same URI across restarts. Default: random. */
  keys?: { walletSecret: string; clientSecret: string };
}

type Tamper = 'amount' | 'hash' | 'expiry' | 'network' | null;

const RECEIVE_ONLY: Nip47Method[] = ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice'];

export class FakeNwcWallet {
  readonly walletSecret: string;
  /** Empty for a wallet created by Nostr Wallet Auth: only the app knows that secret. */
  readonly clientSecret: string;
  readonly walletPubkey: string;
  readonly clientPubkey: string;
  private readonly nodeKey = randomBytes(32);
  private readonly invoices = new Map<string, Nip47Transaction & { preimageHex: string }>();
  private readonly service: NWCWalletService;
  private readonly keypair: NWCWalletServiceKeyPair;
  private unsubscribe: (() => void) | null = null;
  readonly methods: Nip47Method[];
  readonly notifications: boolean;

  /** Make the next make_invoice answer wrong, to test that Selly checks it. */
  tamperNext: Tamper = null;
  /** Make the next make_invoice fail with this NIP-47 error, as a wallet without receiving capacity does. */
  refuseNext: { code: string; message: string } | null = null;
  /** Refuse invoices below this amount as a wallet without a channel does (Alby Hub: about 2,500 sats). */
  minInvoiceMsat = 0;
  /** Requests received, for assertions. */
  readonly calls: string[] = [];

  private constructor(private readonly opts: FakeWalletOptions) {
    this.walletSecret = opts.keys?.walletSecret ?? bytesToHex(randomBytes(32));
    this.walletPubkey = getPublicKey(Buffer.from(this.walletSecret, 'hex'));
    this.clientSecret = opts.clientPubkey
      ? ''
      : (opts.keys?.clientSecret ?? bytesToHex(randomBytes(32)));
    this.clientPubkey = opts.clientPubkey ?? getPublicKey(Buffer.from(this.clientSecret, 'hex'));
    this.methods = opts.methods ?? RECEIVE_ONLY;
    this.notifications = opts.notifications ?? true;
    this.service = new NWCWalletService({ relayUrls: [opts.relayUrl] });
    this.keypair = new NWCWalletServiceKeyPair(this.walletSecret, this.clientPubkey);
  }

  static async start(opts: FakeWalletOptions): Promise<FakeNwcWallet> {
    const w = new FakeNwcWallet(opts);
    if (opts.clientPubkey) await w.publishPairedInfo(opts.clientPubkey);
    else
      await w.service.publishWalletServiceInfoEvent(
        w.walletSecret,
        w.methods,
        w.notifications ? (['payment_received'] satisfies Nip47NotificationType[]) : [],
      );
    await w.goOnline();
    return w;
  }

  /**
   * What a wallet app does when the vendor opens a nostr+walletauth:// link: create a connection for the app's key
   * on the link's relay, and announce it with an info event tagged with that key.
   */
  static async approve(
    walletAuthUri: string,
    opts: Omit<FakeWalletOptions, 'clientPubkey' | 'relayUrl'> & { relayUrl?: string } = {},
  ): Promise<FakeNwcWallet> {
    const url = new URL(walletAuthUri.replace(/^nostr\+walletauth(\+[a-z]+)?:(\/\/)?/, 'http://'));
    const relayUrl = opts.relayUrl ?? url.searchParams.get('relay');
    if (!/^[0-9a-f]{64}$/.test(url.hostname) || !relayUrl)
      throw new Error('not a wallet auth link');
    return FakeNwcWallet.start({ ...opts, relayUrl, clientPubkey: url.hostname });
  }

  private async publishPairedInfo(clientPubkey: string) {
    const relay = await Relay.connect(this.opts.relayUrl);
    try {
      await relay.publish(
        finalizeEvent(
          {
            kind: 13194,
            created_at: Math.floor(Date.now() / 1000),
            content: this.methods.join(' '),
            tags: [
              ['p', clientPubkey],
              ['encryption', 'nip44_v2 nip04'],
              ...(this.notifications ? [['notifications', 'payment_received']] : []),
            ],
          },
          Buffer.from(this.walletSecret, 'hex'),
        ),
      );
    } finally {
      relay.close();
    }
  }

  /** The URI a vendor would paste into Selly. Contains the client secret. */
  get uri(): string {
    return `nostr+walletconnect://${this.walletPubkey}?relay=${encodeURIComponent(this.opts.relayUrl)}&secret=${this.clientSecret}`;
  }

  /** Stops answering requests (the relay still runs). */
  goOffline() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async goOnline() {
    if (this.unsubscribe) return;
    this.unsubscribe = await this.service.subscribe(this.keypair, {
      getInfo: async () => {
        this.calls.push('get_info');
        return {
          result: {
            alias: 'Fake wallet',
            color: '#000000',
            pubkey: this.walletPubkey,
            network: 'mainnet',
            block_height: 1,
            block_hash: '00',
            methods: this.methods,
            ...(this.notifications
              ? { notifications: ['payment_received'] as Nip47NotificationType[] }
              : {}),
          },
          error: undefined,
        };
      },
      getBalance: async () => {
        this.calls.push('get_balance');
        return { result: { balance: this.opts.balanceMsat ?? 184_200_000 }, error: undefined };
      },
      makeInvoice: async (req) => {
        this.calls.push('make_invoice');
        const refuse = this.refuseNext;
        this.refuseNext = null;
        if (refuse) return { result: undefined, error: refuse } as never;
        if (req.amount < this.minInvoiceMsat)
          return {
            result: undefined,
            error: {
              code: 'INTERNAL',
              message: 'NodeError: LiquidityRequestFailed: Failed to request inbound liquidity.',
            },
          } as never;
        const tamper = this.tamperNext;
        this.tamperNext = null;
        const preimage = randomBytes(32);
        const hash = sha256(preimage);
        const now = Math.floor(Date.now() / 1000);
        const expiry = req.expiry ?? 3600;
        const bolt11 = encodeInvoice({
          amountMsat: tamper === 'amount' ? req.amount - 1000 : req.amount,
          paymentHash: hash,
          paymentSecret: randomBytes(32),
          description: req.description ?? '',
          expirySeconds: tamper === 'expiry' ? expiry * 10 : expiry,
          timestamp: now,
          nodeKey: this.nodeKey,
          network: tamper === 'network' ? 'tb' : (this.opts.network ?? 'bc'),
        });
        const reported = tamper === 'hash' ? bytesToHex(sha256(hash)) : bytesToHex(hash);
        const tx: Nip47Transaction & { preimageHex: string } = {
          type: 'incoming',
          state: 'pending',
          invoice: bolt11,
          description: req.description ?? '',
          description_hash: '',
          preimage: '',
          payment_hash: reported,
          amount: req.amount,
          fees_paid: 0,
          settled_at: 0,
          created_at: now,
          expires_at: now + expiry,
          preimageHex: bytesToHex(preimage),
        };
        this.invoices.set(bytesToHex(hash), tx);
        const { preimageHex: _, ...result } = tx;
        return { result, error: undefined };
      },
      lookupInvoice: async (req) => {
        this.calls.push('lookup_invoice');
        const tx = req.payment_hash ? this.invoices.get(req.payment_hash) : undefined;
        if (!tx)
          return { result: undefined, error: { code: 'NOT_FOUND', message: 'invoice not found' } };
        const { preimageHex: _, ...result } = tx;
        return { result, error: undefined };
      },
    });
  }

  /** The customer pays: the invoice settles and, if enabled, a payment_received notification is sent. */
  async pay(paymentHash: string, opts: { notify?: boolean } = {}) {
    const tx = this.invoices.get(paymentHash);
    if (!tx) throw new Error(`fake wallet: unknown invoice ${paymentHash}`);
    tx.state = 'settled';
    tx.settled_at = Math.floor(Date.now() / 1000);
    tx.preimage = tx.preimageHex;
    if (this.notifications && opts.notify !== false) {
      const { preimageHex: _, ...notification } = tx;
      await this.service.publishNotification(this.keypair, {
        notification_type: 'payment_received',
        notification,
      });
    }
  }

  invoiceCount() {
    return this.invoices.size;
  }

  /** The invoices this wallet made, newest first: payment hash, bolt11, amount and state. */
  listInvoices() {
    return [...this.invoices.entries()]
      .map(([hash, tx]) => ({
        paymentHash: hash,
        invoice: tx.invoice,
        amountMsat: tx.amount,
        description: tx.description,
        state: tx.state,
        createdAt: tx.created_at,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The payment hash of a bolt11 this wallet made, or null. */
  hashOf(invoice: string): string | null {
    const wanted = invoice
      .trim()
      .toLowerCase()
      .replace(/^lightning:/, '');
    for (const [hash, tx] of this.invoices) if (tx.invoice.toLowerCase() === wanted) return hash;
    return null;
  }

  close() {
    this.goOffline();
    this.service.close();
  }
}
