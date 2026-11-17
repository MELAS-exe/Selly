export type NwcErrorCode =
  | 'NWC_URI_INVALID'
  | 'NWC_METHODS_MISSING'
  | 'NWC_PERMISSIONS_TOO_BROAD'
  | 'NWC_TIMEOUT'
  | 'NWC_WALLET_ERROR'
  | 'NWC_BAD_INVOICE';

/** Every failure of the NWC layer, with a stable code. `walletCode` is the NIP-47 error code, when the wallet sent one. */
export class NwcError extends Error {
  constructor(
    readonly code: NwcErrorCode,
    message: string,
    readonly walletCode?: string,
  ) {
    super(message);
    this.name = 'NwcError';
  }
}
