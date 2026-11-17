// Permission policy of architecture.md section 3.6.

export const REQUIRED_METHODS = ['make_invoice', 'lookup_invoice'] as const;
export const SPENDING_METHODS = [
  'pay_invoice',
  'pay_keysend',
  'multi_pay_invoice',
  'multi_pay_keysend',
  'pay',
] as const;

export type PolicyResult =
  | { ok: true; receiveOnly: true; hasBalance: boolean }
  | { ok: false; code: 'NWC_METHODS_MISSING' | 'NWC_PERMISSIONS_TOO_BROAD'; methods: string[] };

export function checkPermissions(methods: readonly string[]): PolicyResult {
  const missing = REQUIRED_METHODS.filter((m) => !methods.includes(m));
  if (missing.length > 0) return { ok: false, code: 'NWC_METHODS_MISSING', methods: missing };
  const spending = methods.filter((m) => (SPENDING_METHODS as readonly string[]).includes(m));
  if (spending.length > 0)
    return { ok: false, code: 'NWC_PERMISSIONS_TOO_BROAD', methods: spending };
  return { ok: true, receiveOnly: true, hasBalance: methods.includes('get_balance') };
}

// TODO (Dev 3): URI parsing, NWCClient wrapper over @getalby/sdk, gateway, and testkit/ (fake wallet service).
