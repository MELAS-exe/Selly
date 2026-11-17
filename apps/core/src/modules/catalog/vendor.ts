// The vendor's catalog in the dashboard: list every product, create one (architecture.md section 5.2 group E).
// Changes go through patchProduct (internal.ts) and stock through the inventory module.
import { core } from '@selly/db';
import { and, desc, eq, like, lt, ne, or, sql } from '@selly/db/orm';
import type { Context, Database } from '../../context';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor } from '../../util';
import { audit } from '../events/outbox';
import * as inventory from '../inventory/service';
import { insertImages, processUploads } from '../media/images';
import { currentSubscription, productCount } from '../subscriptions/service';
import { vendorProductView } from './internal';
import { type Vendor, vendorSettings } from './store';

const { products, productVariants: pv } = core;
type Product = typeof products.$inferSelect;

/** "Robe wax noire (T42)" to "robe-wax-noire-t42": what goes after /p/ in the product URL. */
export function slugify(title: string): string {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : `produit-${s || 'x'}`;
}

async function freeSlug(ctx: Context, vendorId: string, base: string): Promise<string> {
  const taken = await ctx.db
    .select({ slug: products.slug })
    .from(products)
    .where(
      and(
        eq(products.vendorId, vendorId),
        or(eq(products.slug, base), like(products.slug, `${base}-%`)),
      ),
    );
  const set = new Set(taken.map((t) => t.slug));
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function listVendorProducts(
  ctx: Context,
  vendor: Vendor,
  q: {
    status?: 'active' | 'hidden' | 'archived' | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
) {
  const conds = [eq(products.vendorId, vendor.id)];
  conds.push(q.status ? eq(products.status, q.status) : ne(products.status, 'archived'));
  if (q.q) {
    const pattern = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(
      sql`public.unaccent_i(${products.title}) ilike public.unaccent_i(${pattern})` as unknown as ReturnType<
        typeof eq
      >,
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
  const last = page.at(-1);
  return {
    data: await Promise.all(page.map((p) => vendorProductView(ctx, p))),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export interface ProductInput {
  title: string;
  description?: string | undefined;
  category?: string | undefined;
  price: { amount: number; currency: 'XOF' | 'SAT' };
  image_keys?: string[] | undefined;
  variants: {
    options: Record<string, string>;
    price_override?: { amount: number; currency: 'XOF' | 'SAT' } | undefined;
    on_hand: number;
  }[];
}

export interface CreateOptions {
  actor?: string;
  /** The draft this product comes from: recorded on the stock movements. */
  draftId?: string;
  /** Runs inside the product's transaction, after the insert: a draft is marked confirmed in the same commit. */
  inTx?: (tx: Database, product: Product) => Promise<void>;
}

/**
 * A new product with its variants and images. Counts against the plan's product limit; initial stock is a restock
 * movement. Images are processed before the transaction, so a bad photo changes nothing.
 */
export async function createVendorProduct(
  ctx: Context,
  vendor: Vendor,
  input: ProductInput,
  opts: CreateOptions = {},
) {
  const currency = vendorSettings(vendor).pricingCurrency;
  const wrong = [
    input.price,
    ...input.variants.flatMap((v) => (v.price_override ? [v.price_override] : [])),
  ].some((m) => m.currency !== currency);
  if (wrong)
    throw new AppError('VALIDATION_FAILED', `This shop prices in ${currency}.`, {
      errors: [{ field: 'price.currency', message: 'Wrong currency' }],
    });

  const seen = new Set(input.variants.map((v) => JSON.stringify(Object.entries(v.options).sort())));
  if (seen.size !== input.variants.length) {
    throw new AppError('VALIDATION_FAILED', 'Two variants have the same options.', {
      errors: [{ field: 'variants', message: 'Duplicate options' }],
    });
  }

  const sub = await currentSubscription(ctx, vendor.id);
  const limit = sub?.limits.products ?? 0;
  const used = await productCount(ctx.db, vendor.id);
  if (used >= limit) {
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      sub
        ? `Your plan allows ${limit} products. You have ${used}.`
        : 'Choose a plan to add products.',
      {
        errors: [
          {
            limit: 'products',
            used,
            max: limit,
            ...(sub?.planId === 'starter'
              ? { upgrade_to: 'pro' }
              : sub?.planId === 'pro'
                ? { upgrade_to: 'business' }
                : {}),
          },
        ],
      },
    );
  }

  const images = await processUploads(ctx.media, vendor.id, [...new Set(input.image_keys ?? [])]);
  const slug = await freeSlug(ctx, vendor.id, slugify(input.title));
  const actor = opts.actor ?? `vendor:${vendor.id}`;
  const product = await ctx.db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        vendorId: vendor.id,
        title: input.title,
        slug,
        description: input.description ?? '',
        category: input.category ?? null,
        priceAmount: input.price.amount,
        priceCurrency: currency,
      })
      .returning();
    const created = p as Product;
    for (const v of input.variants) {
      const [row] = await tx
        .insert(pv)
        .values({
          productId: created.id,
          options: v.options,
          priceOverride: v.price_override?.amount ?? null,
          onHand: 0,
        })
        .returning({ id: pv.id });
      if (v.on_hand > 0)
        await inventory.adjust(
          tx,
          (row as { id: string }).id,
          { delta: v.on_hand },
          'restock',
          actor,
          opts.draftId,
        );
    }
    await insertImages(tx, created.id, images);
    await audit(tx, {
      actor,
      action: 'product.created',
      target: created.id,
      details: {
        title: created.title,
        variants: input.variants.length,
        ...(opts.draftId ? { draft_id: opts.draftId } : {}),
      },
    });
    if (opts.inTx) await opts.inTx(tx, created);
    return created;
  });
  // New images have new URLs, so nothing cached needs purging; a CDN purge hook belongs to the hardening work.
  return vendorProductView(ctx, product);
}
