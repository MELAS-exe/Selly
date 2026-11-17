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
import { getPublicKey } from 'nostr-tools/pure';
import { encodeInvoice } from './bolt11';

export interface FakeWalletOptions {
  relayUrl: string;
  /** Methods this connection allows. Default: receive-only. */
  methods?: Nip47Method[];
  notifications?: boolean;
  balanceMsat?: number;
  network?: 'bc' | 'tb' | 'tbs' | 'bcrt';
}

type Tamper = 'amount' | 'hash' | 'expiry' | 'network' | null;

const RECEIVE_ONLY: Nip47Method[] = ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice'];

export class FakeNwcWallet {
  readonly walletSecret = bytesToHex(randomBytes(32));
  readonly clientSecret = bytesToHex(randomBytes(32));
  readonly walletPubkey = getPublicKey(Buffer.from(this.walletSecret, 'hex'));
  readonly clientPubkey = getPublicKey(Buffer.from(this.clientSecret, 'hex'));
  private readonly nodeKey = randomBytes(32);
  private readonly invoices = new Map<string, Nip47Transaction & { preimageHex: string }>();
  private readonly service: NWCWalletService;
  private readonly keypair: NWCWalletServiceKeyPair;
  private unsubscribe: (() => void) | null = null;
  readonly methods: Nip47Method[];
  readonly notifications: boolean;

  /** Make the next make_invoice answer wrong, to test that Selly checks it. */
  tamperNext: Tamper = null;
  /** Requests received, for assertions. */
  readonly calls: string[] = [];

  private constructor(private readonly opts: FakeWalletOptions) {
    this.methods = opts.methods ?? RECEIVE_ONLY;
    this.notifications = opts.notifications ?? true;
    this.service = new NWCWalletService({ relayUrls: [opts.relayUrl] });
    this.keypair = new NWCWalletServiceKeyPair(this.walletSecret, this.clientPubkey);
  }

  static async start(opts: FakeWalletOptions): Promise<FakeNwcWallet> {
    const w = new FakeNwcWallet(opts);
    await w.service.publishWalletServiceInfoEvent(
      w.walletSecret,
      w.methods,
      w.notifications ? (['payment_received'] satisfies Nip47NotificationType[]) : [],
    );
    await w.goOnline();
    return w;
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

  close() {
    this.goOffline();
    this.service.close();
  }
}
