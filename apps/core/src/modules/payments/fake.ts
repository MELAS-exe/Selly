import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../../util';
import type { InvoiceLookup, InvoiceProvider, MadeInvoice, MakeInvoiceRequest } from './provider';

const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * In-memory Lightning wallet for development and tests. Invoices are well-formed strings but not payable.
 * Call pay() to simulate the customer paying. Never use in production.
 */
export class FakeInvoiceProvider implements InvoiceProvider {
  private readonly invoices = new Map<string, { preimage: string; settled: boolean }>();
  failNext = false;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async makeInvoice(req: MakeInvoiceRequest): Promise<MadeInvoice> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('fake wallet is offline');
    }
    const preimage = randomBytes(32).toString('hex');
    const paymentHash = sha256Hex(Buffer.from(preimage, 'hex'));
    const body = Array.from(randomBytes(120), (b) => BECH[b % 32]).join('');
    this.invoices.set(paymentHash, { preimage, settled: false });
    return {
      source: 'nwc',
      walletConnectionId: null,
      bolt11: `lnbc${req.amountMsat / 1000}n1p${body}`,
      paymentHash,
      amountMsat: req.amountMsat,
      expiresAt: new Date(this.now().getTime() + req.expirySeconds * 1000),
    };
  }

  async lookupInvoice({
    paymentHash,
  }: {
    vendorId: string;
    paymentHash: string;
  }): Promise<InvoiceLookup> {
    const inv = this.invoices.get(paymentHash);
    return inv?.settled ? { settled: true, preimage: inv.preimage } : { settled: false };
  }

  /** Test helper: the customer pays this invoice. */
  pay(paymentHash: string): string {
    const inv = this.invoices.get(paymentHash);
    if (!inv) throw new Error('unknown invoice');
    inv.settled = true;
    return inv.preimage;
  }
}
