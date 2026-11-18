// Read side of the public storefront (architecture.md section 5.2, group A).
import { core } from '@selly/db';
import { and, asc, desc, eq, inArray, lt, ne, or, sql } from '@selly/db/orm';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor, iso, money } from '../../util';
import { currentSubscription, isServing } from '../subscriptions/service';

const { vendors, products, productVariants: pv, productImages, categories } = core;

export type Vendor = typeof vendors.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Variant = typeof pv.$inferSelect;
type Cur = 'XOF' | 'SAT';

export interface DeliveryZone {
  id: string;
  label: string;
  fee: { amount: number; currency: Cur };
}
export interface DeliverySettings {
  zones: DeliveryZone[];
  pickup: { available: boolean; address_text: string | null };
}

/** The customer-facing parts of vendors.settings. Everything has a safe default. */
/** Where the vendor wants alerts: Web Push (on by default) and Nostr direct messages (off; Pro and Business). */
export function alertSettings(v: Vendor) {
  const raw = (
    v.settings as {
      alerts?: { web_push?: boolean; nostr_dm?: { enabled?: boolean; pubkey?: string | null } };
    }
  ).alerts;
  return {
    web_push: raw?.web_push ?? true,
    nostr_dm: { enabled: raw?.nostr_dm?.enabled ?? false, pubkey: raw?.nostr_dm?.pubkey ?? null },
  };
}

export function vendorSettings(v: Vendor) {
  const s = v.settings as {
    pricing_currency?: Cur;
    delivery?: Partial<DeliverySettings>;
    hours?: unknown[];
    agent?: {
      enabled?: boolean;
      tone?: 'friendly' | 'formal';
      languages?: ('fr' | 'wo' | 'en')[];
      negotiation?: { mode?: 'fixed' | 'allow'; max_discount_pct?: number };
    };
    policies?: { returns?: string; payment?: string };
    branding?: {
      logo_key?: string | null;
      primary_color?: string | null;
      accent_color?: string | null;
      banner?: { text?: string; href?: string | null } | null;
    };
  };
  return {
    pricingCurrency: (s.pricing_currency ?? 'XOF') as Cur,
    delivery: {
      zones: s.delivery?.zones ?? [],
      pickup: s.delivery?.pickup ?? { available: false, address_text: null },
    } satisfies DeliverySettings,
    hours: s.hours ?? [],
    agentEnabled: s.agent?.enabled ?? true,
    tone: s.agent?.tone ?? 'friendly',
    // Wolof replies are switched on per vendor only after the evaluation passes (architecture.md section 8.5).
    languages: s.agent?.languages ?? ['fr'],
    policies: {
      returns: s.policies?.returns ?? '',
      payment: s.policies?.payment ?? 'Paiement en bitcoin (Lightning) uniquement.',
    },
    negotiation: {
      mode: s.agent?.negotiation?.mode ?? 'fixed',
      maxDiscountPct: s.agent?.negotiation?.max_discount_pct ?? 0,
    },
    branding: {
      logoKey: s.branding?.logo_key ?? null,
      primaryColor: s.branding?.primary_color ?? '#173B32',
      accentColor: s.branding?.accent_color ?? '#8AAE4A',
      banner: s.branding?.banner
        ? { text: s.branding.banner.text ?? '', href: s.branding.banner.href ?? null }
        : null,
    },
  };
}

export async function findVendorBySlug(ctx: Context, slug: string): Promise<Vendor> {
  const [v] = await ctx.db.select().from(vendors).where(eq(vendors.slug, slug));
  if (!v) throw new AppError('NOT_FOUND', `No shop has the slug "${slug}".`);
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** The vendor named by an internal route. A malformed id is a 404, not a database error. */
export async function findVendorById(ctx: Context, id: string): Promise<Vendor> {
  if (!isUuid(id)) throw new AppError('NOT_FOUND', 'No such vendor.');
  const [v] = await ctx.db.select().from(vendors).where(eq(vendors.id, id));
  if (!v) throw new AppError('NOT_FOUND', 'No such vendor.');
  return v;
}

/**
 * Is the shop open for orders? The vendor must not be suspended by an operator, and must have a plan that is
 * trialing, active or in grace (architecture.md section 3.7). A missing wallet does not close the shop: orders then
 * fail with PAYMENT_UNAVAILABLE, and the dashboard shows the blocker.
 */
export async function storeStatus(ctx: Context, v: Vendor): Promise<'active' | 'paused'> {
  if (v.status !== 'active') return 'paused';
  return isServing(await currentSubscription(ctx, v.id)) ? 'active' : 'paused';
}

/** Has the vendor linked a wallet? Orders are paid into it, so an open shop without one shows but takes no orders. */
export async function hasWallet(ctx: Context, vendorId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: core.walletConnections.id })
    .from(core.walletConnections)
    .where(
      and(
        eq(core.walletConnections.owner, 'vendor'),
        eq(core.walletConnections.vendorId, vendorId),
        ne(core.walletConnections.status, 'revoked'),
      ),
    );
  return !!row;
}

/** Refuses an order on a shop without a wallet, before any stock is reserved. */
export async function requireOrdering(ctx: Context, v: Vendor) {
  if (!(await hasWallet(ctx, v.id)))
    throw new AppError(
      'ORDERS_NOT_OPEN',
      'This shop does not take orders yet: the vendor has not linked a wallet.',
    );
}

export const availabilityOf = (available: number): 'in_stock' | 'low' | 'out_of_stock' =>
  available <= 0 ? 'out_of_stock' : available <= 3 ? 'low' : 'in_stock';

export function imageView(ctx: Context, img: typeof productImages.$inferSelect | undefined) {
  if (!img) return null;
  return {
    url: `${ctx.config.CDN_BASE_URL}/${img.storageKey}`,
    width: img.width,
    height: img.height,
    dominant: img.dominant ?? '#cccccc',
  };
}

function optionsOf(variants: Variant[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const v of variants)
    for (const [k, val] of Object.entries(v.options)) (out[k] ??= new Set()).add(val);
  return Object.fromEntries(Object.entries(out).map(([k, s]) => [k, [...s]]));
}

export async function productSummaries(ctx: Context, rows: Product[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const variants = await ctx.db.select().from(pv).where(inArray(pv.productId, ids));
  const images = await ctx.db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, ids))
    .orderBy(asc(productImages.position));
  return rows.map((p) => {
    const vs = variants.filter((v) => v.productId === p.id);
    const available = vs.reduce((n, v) => n + (v.onHand - v.reserved), 0);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      price: money(p.priceAmount, p.priceCurrency),
      image: imageView(
        ctx,
        images.find((i) => i.productId === p.id),
      ),
      availability: availabilityOf(available),
      options: optionsOf(vs),
      category_id: p.categoryId,
    };
  });
}

export async function listProducts(
  ctx: Context,
  vendorId: string,
  q: { q?: string; category?: string; cursor?: string; limit: number },
) {
  const conds = [eq(products.vendorId, vendorId), eq(products.status, 'active')];
  if (q.category) {
    const [cat] = await ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.vendorId, vendorId), eq(categories.slug, q.category)));
    // An unknown category slug matches nothing, rather than silently ignoring the filter.
    conds.push(cat ? eq(products.categoryId, cat.id) : sql`false`);
  }
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(
      or(
        sql`${products.search} @@ plainto_tsquery('simple', public.unaccent_i(${q.q}))`,
        sql`public.unaccent_i(${products.title}) ilike public.unaccent_i(${like})`,
      ) as ReturnType<typeof eq>,
    );
  }
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      or(
        lt(products.createdAt, c.at),
        and(eq(products.createdAt, c.at), lt(products.id, c.id)),
      ) as ReturnType<typeof eq>,
    );
  }
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(desc(products.createdAt), desc(products.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    data: await productSummaries(ctx, page),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function productDetail(
  ctx: Context,
  vendor: Vendor,
  idOrSlug: string,
  /** Which variants get an exact count: one variant id, or 'all' for the agent. Others get null. */
  exact?: string,
) {
  const byId = isUuid(idOrSlug);
  const [p] = await ctx.db
    .select()
    .from(products)
    .where(
      and(
        eq(products.vendorId, vendor.id),
        eq(products.status, 'active'),
        byId ? eq(products.id, idOrSlug) : eq(products.slug, idOrSlug),
      ),
    );
  if (!p) throw new AppError('NOT_FOUND', 'This product does not exist or is hidden.');
  const variants = await ctx.db.select().from(pv).where(eq(pv.productId, p.id));
  const images = await ctx.db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, p.id))
    .orderBy(asc(productImages.position));
  const total = variants.reduce((n, v) => n + (v.onHand - v.reserved), 0);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    category_id: p.categoryId,
    price: money(p.priceAmount, p.priceCurrency),
    images: images.map((i) => imageView(ctx, i)),
    availability: availabilityOf(total),
    options: optionsOf(variants),
    variants: variants.map((v) => {
      const available = v.onHand - v.reserved;
      return {
        id: v.id,
        options: v.options,
        price: money(v.priceOverride ?? p.priceAmount, p.priceCurrency),
        availability: availabilityOf(available),
        available: exact === 'all' || exact === v.id ? Math.max(available, 0) : null,
      };
    }),
    url: `${ctx.config.APP_BASE_URL}/s/${vendor.slug}/p/${p.slug}`,
  };
}

export async function storeCategories(ctx: Context, vendorId: string) {
  const rows = await ctx.db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.vendorId, vendorId))
    .orderBy(asc(categories.position), asc(categories.name));
  return rows;
}

export async function storeProfile(ctx: Context, v: Vendor) {
  const s = vendorSettings(v);
  const status = await storeStatus(ctx, v);
  const sub = await currentSubscription(ctx, v.id);
  const cats = await storeCategories(ctx, v.id);
  const wallet = await hasWallet(ctx, v.id);
  return {
    slug: v.slug,
    display_name: v.displayName,
    status,
    whatsapp_link: v.contactWhatsappE164
      ? `https://wa.me/${v.contactWhatsappE164.replace('+', '')}`
      : null,
    locale: v.locale,
    pricing_currency: s.pricingCurrency,
    delivery: s.delivery,
    hours: s.hours,
    branding: {
      logo_url: s.branding.logoKey ? `${ctx.config.CDN_BASE_URL}/${s.branding.logoKey}` : null,
      primary_color: s.branding.primaryColor,
      accent_color: s.branding.accentColor,
      banner: s.branding.banner,
    },
    categories: cats,
    chat: {
      enabled: status === 'active' && s.agentEnabled,
      reason: status !== 'active' ? 'store_paused' : s.agentEnabled ? null : 'vendor_disabled',
    },
    ordering: {
      enabled: status === 'active' && wallet,
      reason: status !== 'active' ? 'store_paused' : wallet ? null : 'wallet_missing',
    },
    payment_options: ['lightning'] as const,
    powered_by_badge: sub?.limits.powered_by_badge ?? true,
  };
}

export { iso };
