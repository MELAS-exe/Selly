// Wire types for the vendor dashboard (docs/api.json). The shop, wallet and subscription basics live in
// ../vendor-types.ts; the storefront ones in ../types.ts.

import type { Image, Money, Options, OrderStatus } from '../types';
import type { LiveBlocker, Plan, SubscriptionState } from '../vendor-types';

export type Period = 'today' | '7d' | '30d';

export interface Metrics {
  period: Period;
  orders: { created: number; paid: number; fulfilled: number; pending: number; expired: number };
  revenue: { xof: number; sat: number };
  low_stock: { variant_id: string; title: string; options: Options; available: number }[];
  chats_waiting: number;
  agent_turns: number;
}

export interface DeliveryZone {
  id: string;
  label: string;
  fee: Money;
}

export interface VendorSettings {
  pricing_currency: 'XOF' | 'SAT';
  delivery: {
    zones: DeliveryZone[];
    pickup: { available: boolean; address_text: string | null };
  };
  hours: { days: string; open: string; close: string }[];
  policies?: { returns?: string; payment?: string };
  agent?: unknown;
  alerts?: { web_push: boolean; nostr_dm: { enabled: boolean; pubkey: string | null } };
}

/** GET /vendors/me, with the settings the dashboard needs. */
export interface VendorMe {
  id: string;
  display_name: string;
  slug: string;
  contact_whatsapp_e164: string | null;
  locale: string;
  status: 'active' | 'suspended';
  store_url: string;
  settings: VendorSettings;
  live: boolean;
  live_blockers: LiveBlocker[];
  created_at: string;
}

export interface OrderItem {
  title: string;
  options: Options;
  quantity: number;
  unit_price: Money;
}

export interface VendorOrder {
  id: string;
  number: string;
  status: OrderStatus;
  attention: 'paid_without_stock' | 'paid_twice' | null;
  channel: 'web' | 'whatsapp' | 'instagram';
  customer: { display_name: string; phone_e164: string | null };
  items: OrderItem[];
  subtotal: Money;
  delivery_fee: Money;
  discount: Money;
  total: Money;
  total_sat: number;
  delivery: {
    method: 'delivery' | 'pickup';
    zone_id: string | null;
    address_text: string | null;
    note: string | null;
  };
  conversation_id: string | null;
  expires_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
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
  images: Image[];
  variants: VendorVariant[];
  created_at: string;
  updated_at: string;
}

export type ConversationModeName = 'bot' | 'human' | 'paused';

export interface ConversationSummary {
  id: string;
  channel: 'web' | 'whatsapp' | 'instagram';
  customer_label: string;
  mode: ConversationModeName;
  human_until: string | null;
  unread_count: number;
  order_number: string | null;
  last_message: {
    author: 'customer' | 'agent' | 'vendor' | 'system';
    text: string | null;
    created_at: string;
  };
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  author: 'customer' | 'agent' | 'vendor' | 'system';
  author_label: string | null;
  kind: 'text' | 'audio' | 'image' | 'order_link' | 'system';
  text: string | null;
  cards?: { type: string; title?: string; url?: string; price?: Money }[];
  quick_replies?: { id: string; label: string }[];
  media_key: string | null;
  client_message_id: string | null;
  status: 'accepted' | 'processed' | 'failed';
  created_at: string;
}

export interface ConversationMode {
  id: string;
  mode: ConversationModeName;
  human_until: string | null;
}

export interface DraftField<T = unknown> {
  value: T;
  confidence?: number;
  origin?: 'text' | 'image' | 'price_tag' | 'inferred';
}

export interface Draft {
  id: string;
  status: 'processing' | 'needs_review' | 'confirmed' | 'discarded' | 'failed';
  source: 'dashboard' | 'assistant';
  image_keys: string[];
  input_text: string | null;
  extracted: Record<string, unknown> | null;
  questions: { id: string; text: string; choices: string[] }[];
  matches: { product_id: string; title: string; similarity: number }[];
  created_at: string;
  confirmed_at: string | null;
}

export interface Upload {
  storage_key: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
}

export interface UsageCount {
  used: number;
  limit: number;
  remaining: number;
}

export interface SubscriptionFull {
  subscription: SubscriptionState | null;
  plan: Plan | null;
  usage?: {
    products: UsageCount;
    agent_turns: UsageCount & { month: string };
    drafts: UsageCount & { month: string };
  };
  actions: string[];
}
