import { ApiError } from './browser-api';
import type { LiveBlocker, Vendor } from './vendor-types';

/** The slug core accepts (docs/api.json, VendorCreateRequest). */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** "Awa Style & Co" becomes "awa-style-co". Accents are dropped, anything else becomes a dash. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * A WhatsApp number as E.164. Accepts "+221 77 123 45 67", "00221771234567" and a Senegalese
 * mobile number without its country code ("77 123 45 67"). Returns null when it cannot be read.
 */
export function toE164(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  let e164: string;
  if (raw.startsWith('+')) e164 = `+${digits}`;
  else if (digits.startsWith('00')) e164 = `+${digits.slice(2)}`;
  else if (/^7\d{8}$/.test(digits)) e164 = `+221${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** Where to go after sign-in. Only paths inside the dashboard, never another site. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/app') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}

export type OnboardingStep = 'shop' | 'wallet' | 'plan' | 'done';

/**
 * The first thing still missing for a shop to go live. Core starts the free trial with the shop, so only a key that
 * already had a trial lands on the plan step. The wallet is optional here: without one the shop is live but takes
 * no orders, and the wizard offers it once, right after the shop is created.
 */
export function stepFor(vendor: Pick<Vendor, 'live' | 'live_blockers'>): OnboardingStep {
  if (vendor.live) return 'done';
  const has = (b: LiveBlocker) => vendor.live_blockers.includes(b);
  if (has('subscription_required')) return 'plan';
  return 'done';
}

const MESSAGES: Record<string, string> = {
  NETWORK: 'No connection. Check your network and try again.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  UNAUTHORIZED: 'Your session has ended. Please sign in again.',
  CHALLENGE_INVALID: 'The sign-in request expired or was not valid. Please try again.',
  STEP_UP_REQUIRED: 'Confirm with your Nostr key first.',
  NWC_URI_INVALID: 'This connection link is not valid. Copy it again from your wallet.',
  NWC_PERMISSIONS_TOO_BROAD:
    'This connection can spend your funds. Create a receive-only connection in your wallet.',
  NWC_METHODS_MISSING: 'This wallet cannot create or check invoices.',
  NWC_TIMEOUT: 'Your wallet does not answer. Is it online?',
  NWC_WALLET_ERROR: 'The wallet refused the request, or sent back an invalid invoice.',
  TRIAL_ALREADY_USED:
    'You have already used your free trial. You can choose a plan from the dashboard.',
  PAYMENT_UNAVAILABLE: 'Payments are briefly unavailable. Try again in a moment.',
  INTERNAL: 'Something went wrong on our side. Try again in a moment.',
};

/** A sentence for the vendor. Core's own explanation is kept for validation errors, where it names the field. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const { code, detail } = err.problem;
    if (code === 'VALIDATION_FAILED' && detail) return detail;
    return MESSAGES[code] ?? 'Something went wrong. Please try again.';
  }
  if (err instanceof Error && err.name === 'KeyError') return err.message;
  return 'Something went wrong. Please try again.';
}
