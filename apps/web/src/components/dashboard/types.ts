// Wire types of the vendor dashboard (docs/api.json). Shared ones come from lib/: storefront types, the chat
// widget's message, and the shop, wallet and plans of the onboarding.
import type { ChatMessage } from '@/lib/chat-types';
import type { Image, Money, Options, OrderStatus } from '@/lib/types';
import type {
  Plan,
  PlanId,
  SubscriptionState,
  Vendor as VendorBase,
  Wallet,
} from '@/lib/vendor-types';

export type { ChatMessage, Image, Money, Options, OrderStatus, Plan, PlanId, Wallet };

export interface Branding {
  logo_key: string | null;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  banner: {
    text: string;
    href: string | null;
    image_key?: string | null;
    image_url?: string | null;
  } | null;
}

export interface DeliveryZone {
  id: string;
  label: string;
  fee: Money;
}

export interface Vendor extends VendorBase {
  settings: {
    pricing_currency: 'XOF' | 'SAT';
    delivery?: {
      zones: DeliveryZone[];
      pickup: { available: boolean; address_text: string | null };
    };
    hours?: { days: string; open: string; close: string }[];
    policies?: { returns?: string; payment?: string };
    agent: {
      enabled: boolean;
      tone: 'friendly' | 'formal';
      negotiation?: { mode: 'fixed' | 'allow'; max_discount_pct: number };
      keep_logs?: boolean;
    };
    alerts: { web_push: boolean };
    branding?: Branding;
  };
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface VendorOrder {
  id: string;
  number: string;
  status: OrderStatus;
  attention: 'paid_without_stock' | 'paid_twice' | null;
  channel: 'web' | 'whatsapp' | 'instagram';
  customer: { display_name: string; phone_e164: string | null };
  items: { title: string; options: Options; quantity: number; unit_price: Money }[];
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

export type ConversationMode = 'bot' | 'human' | 'paused';

export interface ConversationSummary {
  id: string;
  channel: 'web' | 'whatsapp' | 'instagram';
  customer_label: string;
  mode: ConversationMode;
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
  category_id: string | null;
  price: Money;
  status: 'active' | 'hidden' | 'archived';
  images: Image[];
  variants: VendorVariant[];
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  position: number;
}

/** One field the vision model read, with how sure it is and where it came from. */
export interface Extracted<T> {
  value: T;
  confidence: number;
  from: 'text' | 'image' | 'price_tag' | 'inferred';
}

export interface Draft {
  id: string;
  status: 'processing' | 'needs_review' | 'confirmed' | 'discarded' | 'failed';
  source: 'dashboard' | 'assistant';
  image_keys: string[];
  input_text: string | null;
  extracted: {
    title?: Extracted<string>;
    description?: Extracted<string>;
    category?: Extracted<string>;
    price?: Extracted<Money>;
    variants?: { options: Options; on_hand?: number }[];
  } | null;
  questions: { id: string; text: string; choices: string[] }[];
  matches: { product_id: string; title: string; similarity: number }[];
  created_at: string;
  confirmed_at: string | null;
}

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
}

export interface SubscriptionView {
  subscription: SubscriptionState | null;
  plan: Plan | null;
  usage: { products: Usage; agent_turns: Usage; drafts: Usage };
  actions: ('start_trial' | 'renew' | 'upgrade' | 'downgrade' | 'resume')[];
}

export interface SubscriptionInvoice {
  id: string;
  status: 'pending' | 'settled' | 'expired' | 'cancelled';
  plan_id: PlanId;
  months: number;
  list_price_sat: number;
  credit_sat: number;
  amount_sat: number;
  bolt11: string;
  lightning_uri: string;
  description: string;
  expires_at: string;
  created_at: string;
  covers: { from: string; to: string };
  settled_at: string | null;
  qr_svg?: string;
}

export type DashboardPeriod = 'today' | '7d' | '30d' | 'year';

export interface DashboardMetrics {
  period: DashboardPeriod;
  orders: { created: number; paid: number; fulfilled: number; pending: number; expired: number };
  revenue: { xof: number; sat: number };
  revenue_previous: { xof: number; sat: number };
  low_stock: { variant_id: string; title: string; options: Options; available: number }[];
  chats_waiting: number;
  agent_turns: number;
  series: { date: string; orders: number; revenue_xof: number }[];
}

export interface BtcXofRate {
  xof_per_btc: number;
  xof_per_sat: number;
  quoted_at: string;
}

export interface Upload {
  storage_key: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_at: string;
}
