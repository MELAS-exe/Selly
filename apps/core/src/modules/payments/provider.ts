// The seam between Selly and Lightning wallets (architecture.md section 3.6).
// NwcGateway (nwc-gateway.ts) talks to each vendor's wallet. FakeInvoiceProvider serves development and tests.

export interface MakeInvoiceRequest {
  vendorId: string;
  amountMsat: number;
  description: string;
  expirySeconds: number;
}

export interface MadeInvoice {
  source: 'nwc' | 'lnurl';
  walletConnectionId: string | null;
  bolt11: string;
  paymentHash: string;
  amountMsat: number;
  expiresAt: Date;
  verifyUrl?: string;
}

export interface InvoiceLookup {
  settled: boolean;
  preimage?: string;
}

export interface InvoiceProvider {
  makeInvoice(req: MakeInvoiceRequest): Promise<MadeInvoice>;
  /** walletConnectionId is the connection that made the invoice (null for the fake provider). */
  lookupInvoice(req: {
    vendorId: string;
    walletConnectionId: string | null;
    paymentHash: string;
  }): Promise<InvoiceLookup>;
}

/**
 * Picks the wallet: the vendor's own for orders, the platform's for subscription invoices (architecture.md 3.7).
 * With the platform provider, `vendorId` names the payer; the invoice is made on the platform wallet.
 */
export interface InvoiceGateway {
  forVendor(vendorId: string): InvoiceProvider;
  forPlatform(): InvoiceProvider;
}

/** One provider for every wallet: the fake provider in development and tests. */
export const singleProvider = (p: InvoiceProvider): InvoiceGateway => ({
  forVendor: () => p,
  forPlatform: () => p,
});
