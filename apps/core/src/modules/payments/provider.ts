// The seam between Selly and Lightning wallets (architecture.md section 3.6).
// The real implementation is the NWC gateway (packages/nwc). FakeInvoiceProvider serves development and tests.

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
  lookupInvoice(req: { vendorId: string; paymentHash: string }): Promise<InvoiceLookup>;
}

/** Picks the provider for a vendor. Today every vendor shares one provider. */
export interface InvoiceGateway {
  forVendor(vendorId: string): InvoiceProvider;
}

export const singleProvider = (p: InvoiceProvider): InvoiceGateway => ({ forVendor: () => p });
