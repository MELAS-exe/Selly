// NWC (NIP-47) for Selly: URI parsing, the permission policy, invoice checks and a client wrapper
// (architecture.md section 3.6). Test helpers live in '@selly/nwc/testkit'.
export { checkInvoice, type DecodedInvoice, decodeInvoice, type LightningNetwork } from './bolt11';
export {
  type CreatedInvoice,
  DEFAULT_TIMEOUTS,
  type InvoiceState,
  NwcConnection,
  type NwcTimeouts,
  type WalletInfo,
} from './connection';
export { NwcError, type NwcErrorCode } from './errors';
export { checkPermissions, type PolicyResult, REQUIRED_METHODS, SPENDING_METHODS } from './policy';
export { type ParsedNwcUri, parseNwcUri } from './uri';
