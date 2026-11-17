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

/** Picks the provider for a vendor. Today every vendor shares one provider. */
export interface InvoiceGateway {
  forVendor(vendorId: string): InvoiceProvider;
}

export const singleProvider = (p: InvoiceProvider): InvoiceGateway => ({ forVendor: () => p });
