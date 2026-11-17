// In-memory stand-in for core's internal API, for tests and the local demo before core exists
// (architecture.md section 12.2: "Dev 2: the scripted LLM provider, a mock core").
// It follows the same contract as HttpCoreClient and enforces the same rules that matter to the agent:
// totals come from here, discounts are capped, stock is reserved by orders.

import { randomBytes } from 'node:crypto';
import { CoreError } from '../errors';
import { uuidv7 } from '../ids';
import type { CoreClient } from './client';
import type {
  Adjustment,
  AdjustmentRequest,
  AgentProfile,
  CartQuote,
  CartQuoteRequest,
  Draft,
  DraftConfirmRequest,
  DraftUpsertRequest,
  Entitlements,
  IntrospectResponse,
  MediaUploadResult,
  Metrics,
  NotificationRequest,
  OrderCreated,
  OrderCreateRequest,
  OrderList,
  OrderStatus,
  OrderStatusView,
  ProductDetail,
  ProductPatchRequest,
  SearchQuery,
  SearchResult,
  UsageRequest,
  UsageResponse,
  VendorLookup,
  VendorProduct,
} from './types';

interface FakeVariant {
  id: string;
  options: Record<string, string>;
  onHand: number;
  reserved: number;
}
interface FakeProduct {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string | null;
  priceXof: number;
  variants: FakeVariant[];
  status: 'active' | 'hidden' | 'archived';
}
interface FakeOrder {
  number: string;
  status: OrderStatus;
  total: number;
  totalSat: number;
  customerName: string;
  items: { variant_id: string; quantity: number }[];
  createdAt: Date;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  idempotencyKey: string;
  conversationRef: string;
  publicToken: string;
}

export const FAKE_VENDOR_ID = '0193a000-0000-7000-8000-000000000001';
export const FAKE_VENDOR_SESSION = 'dev-vendor-session';
const XOF_PER_BTC = 59_036_130; // example rate of architecture.md section 4.5

const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class FakeCore implements CoreClient {
  readonly products: FakeProduct[];
  readonly orders: FakeOrder[] = [];
  readonly drafts = new Map<string, Draft & { vendorId: string }>();
  readonly notifications: (NotificationRequest & { vendorId: string })[] = [];
  readonly usageRefs = new Set<string>();
  usage = { agent_turns: 0, drafts: 0 };
  entitlementsOverride: Partial<Entitlements> = {};
  storeStatus: 'active' | 'paused' = 'active';
  chatEnabled = true;

  constructor(private readonly appBaseUrl = 'http://localhost:3000') {
    this.products = seedProducts();
  }

  private vendor(id: string) {
    if (id !== FAKE_VENDOR_ID) throw new CoreError(404, 'NOT_FOUND', null);
  }
  private productUrl(p: FakeProduct) {
    return `${this.appBaseUrl}/s/awa-style/p/${p.slug}`;
  }
  private imageUrl(p: FakeProduct) {
    return `${this.appBaseUrl}/demo/${p.slug}.webp`;
  }
  private findVariant(variantId: string) {
    for (const p of this.products) {
      const v = p.variants.find((x) => x.id === variantId);
      if (v) return { product: p, variant: v };
    }
    throw new CoreError(422, 'VALIDATION_FAILED', {
      code: 'VALIDATION_FAILED',
      errors: [{ variant_id: variantId, reason: 'unknown variant' }],
    });
  }
  private resolveProduct(ref: string) {
    const p = this.products.find((x) => x.id === ref || x.slug === ref);
    if (!p) throw new CoreError(404, 'NOT_FOUND', null);
    return p;
  }

  async getVendorBySlug(slug: string): Promise<VendorLookup> {
    if (slug !== 'awa-style') throw new CoreError(404, 'NOT_FOUND', null);
    return {
      vendor_id: FAKE_VENDOR_ID,
      slug,
      display_name: 'Awa Style',
      store_status: this.storeStatus,
      chat_enabled: this.chatEnabled,
      locale: 'fr',
    };
  }

  async getAgentProfile(vendorId: string): Promise<AgentProfile> {
    this.vendor(vendorId);
    return {
      vendor_id: FAKE_VENDOR_ID,
      display_name: 'Awa Style',
      slug: 'awa-style',
      locale: 'fr',
      pricing_currency: 'XOF',
      tone: 'friendly',
      negotiation: { mode: 'allow', max_discount_pct: 10 },
      delivery: {
        zones: [
          { id: 'dakar-plateau', label: 'Dakar Plateau', fee: { amount: 1000, currency: 'XOF' } },
          {
            id: 'dakar-banlieue',
            label: 'Banlieue (Pikine, Guédiawaye)',
            fee: { amount: 2000, currency: 'XOF' },
          },
          { id: 'thies', label: 'Thiès', fee: { amount: 3500, currency: 'XOF' } },
        ],
        pickup: { available: true, address_text: 'Marché Sandaga, boutique 12' },
      },
      hours: [{ days: 'lun-sam', open: '09:00', close: '20:00' }],
      policies: {
        returns: 'Échange sous 3 jours si l’article n’a pas été porté.',
        payment: 'Paiement en bitcoin (Lightning) à la commande.',
      },
      whatsapp_link: 'https://wa.me/221770000000',
      store_url: `${this.appBaseUrl}/s/awa-style`,
      languages: ['fr', 'en'],
    };
  }

  async getEntitlements(vendorId: string): Promise<Entitlements> {
    this.vendor(vendorId);
    return {
      vendor_id: FAKE_VENDOR_ID,
      store_status: this.storeStatus,
      plan_id: 'pro',
      subscription_status: 'trialing',
      agent_enabled: true,
      features: { voice_notes: true, nostr_dm_alerts: true },
      limits: { products: 200, agent_turns_per_month: 1500, drafts_per_month: 100 },
      usage: {
        products: this.products.length,
        agent_turns: this.usage.agent_turns,
        drafts: this.usage.drafts,
        month: new Date().toISOString().slice(0, 7),
      },
      valid_for_seconds: 60,
      ...this.entitlementsOverride,
    };
  }

  async reportUsage(vendorId: string, body: UsageRequest): Promise<UsageResponse> {
    const ent = await this.getEntitlements(vendorId);
    const key = `${body.metric}:${body.reference}`;
    if (!this.usageRefs.has(key)) {
      this.usageRefs.add(key);
      this.usage[body.metric] += body.quantity;
    }
    const limit =
      body.metric === 'agent_turns'
        ? ent.limits.agent_turns_per_month
        : ent.limits.drafts_per_month;
    const used = this.usage[body.metric];
    return {
      metric: body.metric,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      exceeded: used >= limit,
      warning: used >= limit * 0.8,
    };
  }

  async searchProducts(vendorId: string, q: SearchQuery): Promise<SearchResult> {
    this.vendor(vendorId);
    const words = normalise(q.q ?? '')
      .split(/\s+/)
      .filter((w) => w.length > 1);
    const scored = this.products
      .filter((p) => p.status === 'active')
      .map((p) => {
        const hay = normalise(`${p.title} ${p.description} ${p.category ?? ''}`);
        const score =
          words.length === 0 ? 1 : words.filter((w) => hay.includes(w.replace(/s$/, ''))).length;
        return { p, score };
      })
      .filter(({ p, score }) => score > 0 && (!q.max_price_xof || p.priceXof <= q.max_price_xof))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(q.limit ?? 5, 5));
    return {
      results: scored.map(({ p }) => ({
        product_id: p.id,
        title: p.title,
        price: { amount: p.priceXof, currency: 'XOF' },
        image_url: this.imageUrl(p),
        url: this.productUrl(p),
        variants: p.variants
          .filter(
            (v) =>
              (!q.size || normalise(v.options.size ?? '') === normalise(q.size)) &&
              (!q.color || normalise(v.options.color ?? '').includes(normalise(q.color))),
          )
          .map((v) => ({ variant_id: v.id, options: v.options, available: v.onHand - v.reserved })),
      })),
    };
  }

  async getProduct(productId: string): Promise<ProductDetail> {
    const p = this.resolveProduct(productId);
    const options: Record<string, string[]> = {};
    for (const v of p.variants)
      for (const [k, val] of Object.entries(v.options)) {
        options[k] ??= [];
        if (!options[k].includes(val)) options[k].push(val);
      }
    const availability = (n: number): ProductDetail['availability'] =>
      n <= 0 ? 'out_of_stock' : n <= 3 ? 'low' : 'in_stock';
    const total = p.variants.reduce((s, v) => s + v.onHand - v.reserved, 0);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      category: p.category,
      price: { amount: p.priceXof, currency: 'XOF' },
      images: [{ url: this.imageUrl(p), width: 640, height: 800, dominant: '#1a1a1a' }],
      availability: availability(total),
      options,
      variants: p.variants.map((v) => ({
        id: v.id,
        options: v.options,
        price: { amount: p.priceXof, currency: 'XOF' },
        availability: availability(v.onHand - v.reserved),
        available: v.onHand - v.reserved,
      })),
      url: this.productUrl(p),
    };
  }

  async createCartQuote(vendorId: string, body: CartQuoteRequest): Promise<CartQuote> {
    const profile = await this.getAgentProfile(vendorId);
    const lines = body.items.map((it) => {
      const { product, variant } = this.findVariant(it.variant_id);
      return {
        variant_id: variant.id,
        title: product.title,
        options: variant.options,
        quantity: it.quantity,
        unit_price: { amount: product.priceXof, currency: 'XOF' as const },
        line_total: { amount: product.priceXof * it.quantity, currency: 'XOF' as const },
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.line_total.amount, 0);
    let deliveryFee = 0;
    if (body.delivery.method === 'delivery') {
      const zone = profile.delivery.zones.find((z) => z.id === body.delivery.zone_id);
      if (!zone)
        throw new CoreError(422, 'VALIDATION_FAILED', {
          code: 'VALIDATION_FAILED',
          errors: [{ field: 'delivery.zone_id', zones: profile.delivery.zones.map((z) => z.id) }],
        });
      deliveryFee = zone.fee.amount;
    }
    const max = profile.negotiation.mode === 'allow' ? profile.negotiation.max_discount_pct : 0;
    const applied = Math.min(body.discount_pct ?? 0, max);
    const discount = Math.floor((subtotal * applied) / 100);
    return {
      lines,
      subtotal: { amount: subtotal, currency: 'XOF' },
      delivery_fee: { amount: deliveryFee, currency: 'XOF' },
      discount: { amount: discount, currency: 'XOF' },
      total: { amount: subtotal - discount + deliveryFee, currency: 'XOF' },
      max_discount_pct: max,
      applied_discount_pct: applied,
    };
  }

  async createOrder(
    vendorId: string,
    body: OrderCreateRequest,
    idempotencyKey: string,
  ): Promise<OrderCreated> {
    const existing = this.orders.find((o) => o.idempotencyKey === idempotencyKey);
    if (existing) return this.orderCreated(existing);
    if (this.storeStatus === 'paused') throw new CoreError(403, 'STORE_PAUSED', null);
    // Like core: re-quote with the (capped) discount, and the expected total must match exactly.
    const quote = await this.createCartQuote(vendorId, {
      items: body.items,
      delivery: body.delivery,
      discount_pct: body.discount_pct,
    });
    if (body.expected_total.amount !== quote.total.amount) {
      throw new CoreError(409, 'PRICE_CHANGED', { code: 'PRICE_CHANGED', quote });
    }
    for (const it of body.items) {
      const { variant } = this.findVariant(it.variant_id);
      if (variant.onHand - variant.reserved < it.quantity)
        throw new CoreError(409, 'OUT_OF_STOCK', {
          code: 'OUT_OF_STOCK',
          errors: [{ variant_id: variant.id, available: variant.onHand - variant.reserved }],
        });
    }
    for (const it of body.items) this.findVariant(it.variant_id).variant.reserved += it.quantity;
    const order: FakeOrder = {
      number: this.nextNumber(),
      status: 'pending_payment',
      total: body.expected_total.amount,
      totalSat: Math.ceil((body.expected_total.amount * 100_000_000) / XOF_PER_BTC),
      customerName: body.customer.display_name,
      items: body.items,
      createdAt: new Date(),
      paidAt: null,
      fulfilledAt: null,
      idempotencyKey,
      conversationRef: body.conversation_ref,
      publicToken: randomBytes(16).toString('base64url').slice(0, 22),
    };
    this.orders.push(order);
    return this.orderCreated(order);
  }

  private nextNumber() {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    let n = '';
    do {
      n = Array.from(
        { length: 4 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join('');
    } while (this.orders.some((o) => o.number === n));
    return n;
  }
  private orderCreated(o: FakeOrder): OrderCreated {
    return {
      number: o.number,
      checkout_url: `${this.appBaseUrl}/c/${o.publicToken}`,
      total: { amount: o.total, currency: 'XOF' },
      total_sat: o.totalSat,
      expires_at: new Date(o.createdAt.getTime() + 22 * 60_000).toISOString(),
    };
  }
  private orderView(o: FakeOrder): OrderStatusView {
    return {
      number: o.number,
      status: o.status,
      paid_at: o.paidAt?.toISOString() ?? null,
      fulfilled_at: o.fulfilledAt?.toISOString() ?? null,
      total: { amount: o.total, currency: 'XOF' },
    };
  }

  async getOrder(vendorId: string, orderRef: string): Promise<OrderStatusView> {
    this.vendor(vendorId);
    const o = this.orders.find((x) => x.number === orderRef.toUpperCase());
    if (!o) throw new CoreError(404, 'NOT_FOUND', null);
    return this.orderView(o);
  }

  async listOrders(
    vendorId: string,
    q: { status?: OrderStatus; period?: 'today' | '7d' },
  ): Promise<OrderList> {
    this.vendor(vendorId);
    const since = Date.now() - (q.period === '7d' ? 7 : 1) * 86_400_000;
    return {
      data: this.orders
        .filter((o) => (!q.status || o.status === q.status) && o.createdAt.getTime() >= since)
        .map((o) => ({
          number: o.number,
          status: o.status,
          total: { amount: o.total, currency: 'XOF' },
          customer_name: o.customerName,
          created_at: o.createdAt.toISOString(),
        })),
    };
  }

  async fulfillOrder(vendorId: string, orderRef: string): Promise<OrderStatusView> {
    this.vendor(vendorId);
    const o = this.orders.find((x) => x.number === orderRef.toUpperCase());
    if (!o) throw new CoreError(404, 'NOT_FOUND', null);
    if (o.status !== 'paid')
      throw new CoreError(409, 'VALIDATION_FAILED', { detail: `order is ${o.status}` });
    o.status = 'fulfilled';
    o.fulfilledAt = new Date();
    return this.orderView(o);
  }

  /** Test helper: what core does when the invoice settles. */
  markPaid(number: string) {
    const o = this.orders.find((x) => x.number === number);
    if (!o) throw new Error(`no order ${number}`);
    o.status = 'paid';
    o.paidAt = new Date();
    for (const it of o.items) {
      const { variant } = this.findVariant(it.variant_id);
      variant.reserved -= it.quantity;
      variant.onHand -= it.quantity;
    }
    return o;
  }

  async getMetrics(vendorId: string, period: 'today' | '7d' | '30d'): Promise<Metrics> {
    this.vendor(vendorId);
    const count = (s: OrderStatus) => this.orders.filter((o) => o.status === s).length;
    const paid = this.orders.filter((o) => o.status === 'paid' || o.status === 'fulfilled');
    return {
      period,
      orders: {
        created: this.orders.length,
        paid: paid.length,
        fulfilled: count('fulfilled'),
        pending: count('pending_payment'),
        expired: count('expired'),
      },
      revenue: {
        xof: paid.reduce((s, o) => s + o.total, 0),
        sat: paid.reduce((s, o) => s + o.totalSat, 0),
      },
      low_stock: this.products.flatMap((p) =>
        p.variants
          .filter((v) => v.onHand - v.reserved <= 2)
          .map((v) => ({
            variant_id: v.id,
            title: p.title,
            options: v.options,
            available: v.onHand - v.reserved,
          })),
      ),
      chats_waiting: 0,
      agent_turns: this.usage.agent_turns,
    };
  }

  async upsertDraft(vendorId: string, body: DraftUpsertRequest): Promise<Draft> {
    this.vendor(vendorId);
    const existing = body.draft_id ? this.drafts.get(body.draft_id) : undefined;
    const title = String((body.extracted?.title as { value?: unknown } | undefined)?.value ?? '');
    const matches = this.products
      .filter((p) => title && normalise(p.title).split(' ')[0] === normalise(title).split(' ')[0])
      .map((p) => ({ product_id: p.id, title: p.title, similarity: 0.7 }));
    const draft: Draft & { vendorId: string } = {
      vendorId,
      id: existing?.id ?? uuidv7(),
      status: body.extracted ? 'needs_review' : 'processing',
      source: 'assistant',
      image_keys: body.image_keys,
      input_text: body.input_text ?? existing?.input_text ?? null,
      extracted: body.extracted ?? existing?.extracted ?? null,
      questions: body.questions ?? existing?.questions ?? [],
      matches,
      created_at: existing?.created_at ?? new Date().toISOString(),
      confirmed_at: null,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async confirmDraft(draftId: string, body: DraftConfirmRequest): Promise<VendorProduct> {
    const draft = this.drafts.get(draftId);
    if (!draft || draft.status !== 'needs_review') throw new CoreError(404, 'NOT_FOUND', null);
    const x = (draft.extracted ?? {}) as Record<string, { value?: unknown }>;
    const variants = (x.variants?.value as
      | { options: Record<string, string>; stock: number }[]
      | undefined) ?? [{ options: {}, stock: Number(x.stock?.value ?? 1) }];
    let product: FakeProduct;
    if (body.mode === 'restock' && body.target_product_id) {
      product = this.resolveProduct(body.target_product_id);
      for (const nv of variants) {
        const v = product.variants.find(
          (pv) => JSON.stringify(pv.options) === JSON.stringify(nv.options),
        );
        if (v) v.onHand += nv.stock;
        else
          product.variants.push({
            id: uuidv7(),
            options: nv.options,
            onHand: nv.stock,
            reserved: 0,
          });
      }
    } else {
      const title = String(x.title?.value ?? 'Nouveau produit');
      product = {
        id: uuidv7(),
        slug: normalise(title)
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        title,
        description: String(x.description?.value ?? ''),
        category: (x.category?.value as string | undefined) ?? null,
        priceXof: Number((x.price?.value as { amount?: number } | undefined)?.amount ?? 0),
        variants: variants.map((v) => ({
          id: uuidv7(),
          options: v.options,
          onHand: v.stock,
          reserved: 0,
        })),
        status: 'active',
      };
      this.products.push(product);
    }
    draft.status = 'confirmed';
    draft.confirmed_at = new Date().toISOString();
    return this.vendorProduct(product);
  }

  private vendorProduct(p: FakeProduct): VendorProduct {
    const now = new Date().toISOString();
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      category: p.category,
      price: { amount: p.priceXof, currency: 'XOF' },
      status: p.status,
      images: [],
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: null,
        options: v.options,
        price_override: null,
        on_hand: v.onHand,
        reserved: v.reserved,
        available: v.onHand - v.reserved,
      })),
      created_at: now,
      updated_at: now,
    };
  }

  async adjustStock(
    vendorId: string,
    variantId: string,
    body: AdjustmentRequest,
  ): Promise<Adjustment> {
    this.vendor(vendorId);
    const { variant } = this.findVariant(variantId);
    const target = body.set_to ?? variant.onHand + (body.delta ?? 0);
    if (target < variant.reserved)
      throw new CoreError(409, 'VALIDATION_FAILED', {
        detail: 'stock cannot go below reserved units',
      });
    const delta = target - variant.onHand;
    variant.onHand = target;
    return {
      variant: {
        id: variant.id,
        sku: null,
        options: variant.options,
        price_override: null,
        on_hand: variant.onHand,
        reserved: variant.reserved,
        available: variant.onHand - variant.reserved,
      },
      movement: {
        id: uuidv7(),
        delta_on_hand: delta,
        reason: body.reason,
        created_at: new Date().toISOString(),
      },
    };
  }

  async updateProduct(
    vendorId: string,
    productId: string,
    body: ProductPatchRequest,
  ): Promise<VendorProduct> {
    this.vendor(vendorId);
    const p = this.resolveProduct(productId);
    if (body.title) p.title = body.title;
    if (body.description !== undefined) p.description = body.description;
    if (body.price) p.priceXof = body.price.amount;
    if (body.status) p.status = body.status;
    return this.vendorProduct(p);
  }

  async uploadMedia(bytes: Buffer, contentType: string): Promise<MediaUploadResult> {
    return {
      storage_key: `uploads/fake/${uuidv7()}`,
      content_type: contentType,
      size_bytes: bytes.length,
    };
  }

  async notifyVendor(vendorId: string, body: NotificationRequest): Promise<void> {
    this.notifications.push({ ...body, vendorId });
  }

  async introspectSession(sessionCookie: string): Promise<IntrospectResponse> {
    const valid = sessionCookie === FAKE_VENDOR_SESSION;
    return {
      valid,
      vendor_id: valid ? FAKE_VENDOR_ID : null,
      pubkey: valid ? 'a'.repeat(64) : null,
      step_up_expires_at: null,
    };
  }
}

function seedProducts(): FakeProduct[] {
  const sizes = (list: string[], color: string, stock: number[]) =>
    list.map((size, i) => ({
      id: uuidv7(),
      options: { size, color },
      onHand: stock[i] ?? 0,
      reserved: 0,
    }));
  return [
    {
      id: '0193a8f0-6a1e-7c3b-9a1d-3f2b1c0d4e5f',
      slug: 'robe-wax-noire',
      title: 'Robe wax noire',
      description: 'Robe longue en wax, coupe ajustée, motifs noir et or.',
      category: 'robes',
      priceXof: 15000,
      variants: sizes(['38', '40', '42', '44'], 'noir', [1, 3, 2, 0]),
      status: 'active',
    },
    {
      id: '0193a8f0-6a1e-7c3b-9a1d-3f2b1c0d4e60',
      slug: 'boubou-bazin-bleu',
      title: 'Boubou bazin bleu',
      description: 'Grand boubou en bazin riche, brodé à la main.',
      category: 'boubous',
      priceXof: 35000,
      variants: [
        { id: uuidv7(), options: { size: 'M', color: 'bleu' }, onHand: 2, reserved: 0 },
        { id: uuidv7(), options: { size: 'L', color: 'bleu' }, onHand: 4, reserved: 0 },
      ],
      status: 'active',
    },
    {
      id: '0193a8f0-6a1e-7c3b-9a1d-3f2b1c0d4e61',
      slug: 'baskets-blanches',
      title: 'Baskets blanches',
      description: 'Baskets en cuir blanc, semelle confortable.',
      category: 'chaussures',
      priceXof: 20000,
      variants: sizes(['40', '41', '42', '43', '44'], 'blanc', [5, 5, 5, 5, 5]),
      status: 'active',
    },
    {
      id: '0193a8f0-6a1e-7c3b-9a1d-3f2b1c0d4e62',
      slug: 'sac-cuir-marron',
      title: 'Sac en cuir marron',
      description: 'Sac à main en cuir de Ngaye Mékhé.',
      category: 'sacs',
      priceXof: 18000,
      variants: [{ id: uuidv7(), options: { color: 'marron' }, onHand: 3, reserved: 0 }],
      status: 'active',
    },
  ];
}
