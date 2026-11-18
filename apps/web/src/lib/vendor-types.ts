// Wire types for the vendor side: plans, sign-in, shop, wallet and subscription (docs/api.json).
// The storefront types live in ./types.ts.

export type PlanId = 'starter' | 'pro' | 'business';

export interface PlanPeriod {
  months: 1 | 3 | 12;
  price_sat: number;
  discount_pct: number;
  /** At the current BTC/XOF rate. Display only; null when no rate is available. */
  indicative_xof: number | null;
}

export interface PlanLimits {
  products: number;
  agent_turns_per_month: number;
  drafts_per_month: number;
  voice_notes: boolean;
  nostr_dm_alerts: boolean;
  powered_by_badge: boolean;
  embed_widget: boolean;
  support: 'help_pages' | 'two_working_days' | 'one_working_day';
}

export interface Plan {
  id: PlanId;
  name: string;
  monthly_price_sat: number;
  periods: PlanPeriod[];
  limits: PlanLimits;
}

export interface PlansResponse {
  data: Plan[];
  trial: { plan_id: PlanId; days: number };
  grace_days: number;
  rate: { xof_per_btc: number; source: string; quoted_at: string } | null;
}

export interface UnsignedNostrEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface SignedNostrEvent extends UnsignedNostrEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export interface ChallengeResponse {
  challenge_id: string;
  challenge: string;
  purpose: 'sign_in' | 'step_up' | 'add_key';
  expires_at: string;
  event_template: UnsignedNostrEvent;
}

export interface SessionInfo {
  id: string;
  pubkey: string;
  created_at: string;
  expires_at: string;
  step_up_expires_at: string | null;
}

export interface VendorSummary {
  id: string;
  display_name: string;
  slug: string;
  status: 'active' | 'suspended';
}

export interface NostrSessionResponse {
  session: SessionInfo;
  /** Null for a key that has no shop yet. */
  vendor: VendorSummary | null;
}

export type LiveBlocker =
  | 'wallet_missing'
  | 'wallet_degraded'
  | 'subscription_required'
  | 'subscription_suspended';

export interface Vendor {
  id: string;
  display_name: string;
  slug: string;
  contact_whatsapp_e164: string | null;
  locale: string;
  status: 'active' | 'suspended';
  store_url: string;
  live: boolean;
  live_blockers: LiveBlocker[];
  created_at: string;
}

export interface VendorCreateRequest {
  display_name: string;
  slug: string;
  contact_whatsapp_e164?: string;
}

export type WalletLinkRequest =
  | { kind: 'nwc'; uri: string }
  | { kind: 'lightning_address'; lud16: string };

export interface Wallet {
  kind: 'nwc' | 'lightning_address';
  status: 'active' | 'degraded' | 'revoked';
  methods: string[];
  notifications: boolean;
  receive_only: boolean;
  relays: string[];
  lud16: string | null;
  balance_sat: number | null;
  checked_at: string;
  last_error: string | null;
}

export interface SubscriptionState {
  plan_id: PlanId;
  next_plan_id: PlanId | null;
  status: 'trialing' | 'active' | 'grace' | 'suspended';
  trial: boolean;
  current_period_start: string;
  current_period_end: string;
  grace_ends_at: string | null;
}

export interface SubscriptionView {
  subscription: SubscriptionState | null;
  plan: Plan | null;
  actions: string[];
}
