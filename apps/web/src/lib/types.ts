// Response shapes from docs/api.json, limited to what the web app reads.
// Keep in step with the contract; @selly/contracts will replace these once it exports them.

export type Currency = 'XOF' | 'SAT';
export interface Money {
  amount: number;
  currency: Currency;
}

export type Availability = 'in_stock' | 'low' | 'out_of_stock';
export type Options = Record<string, string>;

export interface Image {
  url: string;
  width: number;
  height: number;
  dominant: string;
}

export interface ProductSummary {
  id: string;
  slug: string;
  title: string;
  price: Money;
  image: Image | null;
  availability: Availability;
  options: Record<string, string[]>;
  category_id: string | null;
}

export interface PublicVariant {
  id: string;
  options: Options;
  price: Money;
  availability: Availability;
  available: number | null;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category_id: string | null;
  price: Money;
  images: Image[];
  availability: Availability;
  options: Record<string, string[]>;
  variants: PublicVariant[];
  url: string;
}

export interface DeliveryZone {
  id: string;
  label: string;
  fee: Money;
}

export interface CategorySummary {
  id: string;
  name: string;
  slug: string;
}

export interface Branding {
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  /** image_url: missing on an older core. */
  banner: { text: string; href: string | null; image_url?: string | null } | null;
}

export interface StorePublic {
  slug: string;
  display_name: string;
  status: string;
  whatsapp_link: string | null;
  locale: string;
  pricing_currency: Currency;
  delivery: {
    zones: DeliveryZone[];
    pickup: { available: boolean; address_text: string | null };
  };
  hours: { days: string; open: string; close: string }[];
  branding: Branding;
  categories: CategorySummary[];
  chat: { enabled: boolean; reason: string | null };
  /** Missing on an older core: treat as open. */
  ordering?: { enabled: boolean; reason: 'store_paused' | 'wallet_missing' | null };
  payment_options: 'lightning'[];
  powered_by_badge: boolean;
}

export interface StorePage {
  /** The shop is not published and this is its owner: show everything, with the preview notice. */
  preview?: true;
  store: StorePublic;
  products: ProductSummary[];
  next_cursor: string | null;
}

export interface QuoteLine {
  variant_id: string;
  title: string;
  options: Options;
  quantity: number;
  unit_price: Money;
  line_total: Money;
}

export interface CartQuote {
  lines: QuoteLine[];
  subtotal: Money;
  delivery_fee: Money;
  discount: Money;
  total: Money;
  total_sat: number;
  rate: { xof_per_btc: number; source: string; quoted_at: string };
}

export type OrderStatus = 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'expired';
export type InvoiceStatus = 'pending' | 'settled' | 'expired' | 'cancelled';

export interface InvoiceView {
  bolt11: string;
  payment_hash: string;
  amount_msat: number;
  status: InvoiceStatus;
  expires_at: string;
  lightning_uri: string;
  qr_svg?: string;
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  public_token: string;
  items: { title: string; options: Options; quantity: number; unit_price: Money }[];
  subtotal: Money;
  delivery_fee: Money;
  discount: Money;
  total: Money;
  total_sat: number;
  expires_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
}

export interface CheckoutView {
  order: OrderView;
  invoice: InvoiceView | null;
  store: { slug: string; display_name: string; whatsapp_link: string | null };
  payment_options: 'lightning'[];
  help_url: string;
}

export interface OrderCreated {
  order: OrderView;
  invoice: InvoiceView;
  checkout_url: string;
  payment_options: 'lightning'[];
}

/** RFC 9457 problem details, with the stable code from architecture.md 7.4. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  errors?: Record<string, unknown>[];
}
