// Shapes of the internal core API used by the agent (docs/api.json, tag "Internal").
// Hand-written until packages/contracts generates typed clients (architecture.md section 5.4).

export interface Money {
  amount: number;
  currency: 'XOF' | 'SAT';
}
export type Options = Record<string, string>;
export type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'expired';
export type PlanId = 'starter' | 'pro' | 'business';

export interface ProductCard {
  type: 'product';
  product_id: string;
  title: string;
  price: Money;
  image_url: string | null;
  url: string;
}
export interface OrderCard {
  type: 'order';
  number: string;
  status: OrderStatus;
  total: Money;
  total_sat: number;
  checkout_url: string;
  expires_at: string | null;
}
export type Card = ProductCard | OrderCard;
export interface QuickReply {
  id: string;
  label: string;
}

export interface VendorLookup {
  vendor_id: string;
  slug: string;
  display_name: string;
  store_status: 'active' | 'paused';
  chat_enabled: boolean;
  locale: string;
}

export interface AgentProfile {
  vendor_id: string;
  display_name: string;
  slug: string;
  locale: string;
  pricing_currency: 'XOF' | 'SAT';
  tone: 'friendly' | 'formal';
  negotiation: { mode: 'fixed' | 'allow'; max_discount_pct: number };
  delivery: {
    zones: { id: string; label: string; fee: Money }[];
    pickup: { available: boolean; address_text: string | null };
  };
  hours: { days: string; open: string; close: string }[];
  policies: { returns: string; payment: string };
  whatsapp_link: string | null;
  store_url: string;
  languages: ('fr' | 'wo' | 'en')[];
}

export interface Entitlements {
  vendor_id: string;
  store_status: 'active' | 'paused';
  plan_id: PlanId | null;
  subscription_status: 'trialing' | 'active' | 'grace' | 'suspended' | null;
  agent_enabled: boolean;
  features: { voice_notes: boolean; nostr_dm_alerts: boolean };
  limits: { products: number; agent_turns_per_month: number; drafts_per_month: number };
  usage: { products: number; agent_turns: number; drafts: number; month: string };
  valid_for_seconds: number;
}

export interface UsageRequest {
  metric: 'agent_turns' | 'drafts';
  quantity: number;
  reference: string;
}
export interface UsageResponse {
  metric: 'agent_turns' | 'drafts';
  used: number;
  limit: number;
  remaining: number;
  exceeded: boolean;
  warning: boolean;
}

export interface SearchQuery {
  q?: string;
  size?: string;
  color?: string;
  max_price_xof?: number;
  limit?: number;
}
export interface SearchResult {
  results: {
    product_id: string;
    title: string;
    price: Money;
    image_url: string | null;
    url: string;
    variants: { variant_id: string; options: Options; available: number }[];
  }[];
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  price: Money;
  images: { url: string; width: number; height: number; dominant: string }[];
  availability: 'in_stock' | 'low' | 'out_of_stock';
  options: Record<string, string[]>;
  variants: {
    id: string;
    options: Options;
    price: Money;
    availability: 'in_stock' | 'low' | 'out_of_stock';
    available: number | null;
  }[];
  url: string;
}

export interface CartItemInput {
  variant_id: string;
  quantity: number;
}
export interface DeliveryInput {
  method: 'delivery' | 'pickup';
  zone_id?: string;
  address_text?: string;
  note?: string;
}
export interface CartQuoteRequest {
  items: CartItemInput[];
  delivery: DeliveryInput;
  discount_pct?: number;
}
export interface CartQuote {
  lines: {
    variant_id: string;
    title: string;
    options: Options;
    quantity: number;
    unit_price: Money;
    line_total: Money;
  }[];
  subtotal: Money;
  delivery_fee: Money;
  discount: Money;
  total: Money;
  max_discount_pct: number;
  applied_discount_pct: number;
}

export interface OrderCreateRequest {
  conversation_ref: string;
  customer: { display_name: string; phone_e164: string };
  items: CartItemInput[];
  delivery: DeliveryInput;
  expected_total: Money;
}
export interface OrderCreated {
  number: string;
  checkout_url: string;
  total: Money;
  total_sat: number;
  expires_at: string;
}
export interface OrderStatusView {
  number: string;
  status: OrderStatus;
  paid_at: string | null;
  fulfilled_at: string | null;
  total: Money;
}
export interface OrderList {
  data: {
    number: string;
    status: OrderStatus;
    total: Money;
    customer_name: string;
    created_at: string;
  }[];
}

export interface Metrics {
  period: 'today' | '7d' | '30d';
  orders: { created: number; paid: number; fulfilled: number; pending: number; expired: number };
  revenue: { xof: number; sat: number };
  low_stock: { variant_id: string; title: string; options: Options; available: number }[];
  chats_waiting: number;
  agent_turns: number;
}

export interface DraftQuestion {
  id: string;
  text: string;
  choices: string[];
}
export interface DraftUpsertRequest {
  draft_id?: string | null;
  image_keys: string[];
  input_text?: string;
  extracted?: Record<string, unknown>;
  questions?: DraftQuestion[];
}
export interface Draft {
  id: string;
  status: 'processing' | 'needs_review' | 'confirmed' | 'discarded' | 'failed';
  source: 'dashboard' | 'assistant';
  image_keys: string[];
  input_text: string | null;
  extracted: Record<string, unknown> | null;
  questions: DraftQuestion[];
  matches: { product_id: string; title: string; similarity: number }[];
  created_at: string;
  confirmed_at: string | null;
}
export interface DraftConfirmRequest {
  answers?: Record<string, string>;
  edits?: Record<string, unknown>;
  mode: 'new' | 'restock';
  target_product_id?: string | null;
}

export interface VendorVariant {
  id: string;
  sku: string | null;
  options: Options;
  price_override: Money | null;
  on_hand: number;
  reserved: number;
  available: number;
}
export interface VendorProduct {
  id: string;
  title: string;
  description: string;
  category: string | null;
  price: Money;
  status: 'active' | 'hidden' | 'archived';
  images: { url: string; width: number; height: number; dominant: string }[];
  variants: VendorVariant[];
  created_at: string;
  updated_at: string;
}
export interface AdjustmentRequest {
  delta?: number;
  set_to?: number;
  reason: 'restock' | 'adjustment';
}
export interface Adjustment {
  variant: VendorVariant;
  movement: {
    id: string;
    delta_on_hand: number;
    reason: 'restock' | 'adjustment';
    created_at: string;
  };
}
export interface ProductPatchRequest {
  title?: string;
  description?: string;
  category?: string;
  price?: Money;
  status?: 'active' | 'hidden' | 'archived';
}

export interface NotificationRequest {
  type: 'conversation.handoff' | 'conversation.new' | 'usage.warning';
  conversation_id?: string;
  title: string;
  body?: string;
  url?: string;
}

export interface IntrospectResponse {
  valid: boolean;
  vendor_id: string | null;
  pubkey: string | null;
  step_up_expires_at: string | null;
}

export interface MediaUploadResult {
  storage_key: string;
  content_type: string;
  size_bytes: number;
}

export type CoreEventType =
  | 'order.created'
  | 'order.paid'
  | 'order.expired'
  | 'order.cancelled'
  | 'order.fulfilled'
  | 'draft.requested'
  | 'wallet.degraded'
  | 'wallet.restored'
  | 'stock.low'
  | 'entitlements.changed';

export interface CoreEvent {
  event_id: string;
  type: CoreEventType;
  occurred_at: string;
  vendor_id: string;
  data: Record<string, unknown>;
}
