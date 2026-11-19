// Catalog reads and writes for the agent (architecture.md sections 5.2 group G and 8.3). Every query is scoped to
// the vendor of the route, so one shop's conversation can never read or change another shop's products.
import { core } from '@selly/db';
import { and, asc, eq, inArray, lte, or, sql } from '@selly/db/orm';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso, money } from '../../util';
import { audit } from '../events/outbox';
import { insertImages, type PreparedImage, processUpload } from '../media/images';
import { requireOwnCategory } from './categories';
import { imageView, isUuid, type Vendor, vendorSettings } from './store';

const { products, productVariants: pv, productImages } = core;
type Product = typeof products.$inferSelect;
type Variant = typeof pv.$inferSelect;

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

/** Options are matched without case or accents, and "T42" or "pointure 42" match "42". */
function optionMatches(value: string | undefined, wanted: string | undefined): boolean {
  if (!wanted) return true;
  if (value === undefined) return false;
  const v = norm(value);
  const w = norm(wanted).replace(/^(t|taille|pointure)\s*/, '');
  return v === w || v.replace(/^(t|taille|pointure)\s*/, '') === w;
}

// Vendors name their options in their own words: a size is "taille" for a dress and "pointure" for shoes.
const SIZE_KEYS = ['size', 'taille', 'pointure'];
const COLOR_KEYS = ['color', 'colour', 'couleur'];

/** The value of the first option whose name is one of `keys`, without case or accents. */
function optionNamed(options: Record<string, string>, keys: readonly string[]) {
  for (const [key, value] of Object.entries(options)) if (keys.includes(norm(key))) return value;
  return undefined;
}

export async function searchProducts(
  ctx: Context,
  vendor: Vendor,
  q: {
    q?: string | undefined;
    size?: string | undefined;
    color?: string | undefined;
    maxPriceXof?: number | undefined;
    limit: number;
  },
) {
  const conds = [eq(products.vendorId, vendor.id), eq(products.status, 'active')];
  if (q.maxPriceXof !== undefined) conds.push(lte(products.priceAmount, q.maxPriceXof));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(
      or(
        sql`${products.search} @@ plainto_tsquery('simple', public.unaccent_i(${q.q}))`,
        sql`public.unaccent_i(${products.title}) ilike public.unaccent_i(${like})`,
        sql`similarity(public.unaccent_i(${products.title}), public.unaccent_i(${q.q})) > 0.3`,
      ) as ReturnType<typeof eq>,
    );
  }
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(...conds))
    .orderBy(
      q.q
        ? sql`similarity(public.unaccent_i(${products.title}), public.unaccent_i(${q.q})) desc`
        : asc(products.title),
      asc(products.id),
    )
    .limit(25);
  if (rows.length === 0) return { results: [] };

  const ids = rows.map((r) => r.id);
  const variants = await ctx.db.select().from(pv).where(inArray(pv.productId, ids));
  const images = await ctx.db
    .select()
    .from(productImages)
    .where(inArray(productImages.productId, ids))
    .orderBy(asc(productImages.position));

  const results = [];
  for (const p of rows) {
    const vs = variants
      .filter((v) => v.productId === p.id)
      .filter(
        (v) =>
          optionMatches(optionNamed(v.options, SIZE_KEYS), q.size) &&
          optionMatches(optionNamed(v.options, COLOR_KEYS), q.color),
      );
    if (vs.length === 0) continue; // the size or colour asked for does not exist for this product
    results.push({
      product_id: p.id,
      title: p.title,
      price: money(p.priceAmount, p.priceCurrency),
      image_url:
        imageView(
          ctx,
          images.find((i) => i.productId === p.id),
        )?.url ?? null,
      url: `${ctx.config.APP_BASE_URL}/s/${vendor.slug}/p/${p.slug}`,
      variants: vs.map((v) => ({
        variant_id: v.id,
        options: v.options,
        available: Math.max(v.onHand - v.reserved, 0),
      })),
    });
    if (results.length >= q.limit) break;
  }
  return { results };
}

export function vendorVariantView(p: Pick<Product, 'priceCurrency'>, v: Variant) {
  return {
    id: v.id,
    sku: v.sku,
    options: v.options,
    price_override: v.priceOverride === null ? null : money(v.priceOverride, p.priceCurrency),
    on_hand: v.onHand,
    reserved: v.reserved,
    available: v.onHand - v.reserved,
  };
}

export async function vendorProductView(ctx: Context, p: Product) {
  const variants = await ctx.db.select().from(pv).where(eq(pv.productId, p.id));
  const images = await ctx.db
    .select()
    .from(productImages)
    .where(eq(productImages.productId, p.id))
    .orderBy(asc(productImages.position));
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    category_id: p.categoryId,
    price: money(p.priceAmount, p.priceCurrency),
    status: p.status,
    // The storage key lets the dashboard keep a photo when it edits the product (PATCH image_keys).
    images: images.map((i) => ({ ...imageView(ctx, i), storage_key: i.storageKey })),
    variants: variants.map((v) => vendorVariantView(p, v)),
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
  };
}

export async function findVendorProduct(
  ctx: Context,
  vendor: Vendor,
  productId: string,
): Promise<Product> {
  if (!isUuid(productId)) throw new AppError('NOT_FOUND', 'No such product.');
  const [p] = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.vendorId, vendor.id)));
  if (!p) throw new AppError('NOT_FOUND', 'No such product.');
  return p;
}

export interface ProductPatch {
  title?: string | undefined;
  description?: string | undefined;
  category_id?: string | null | undefined;
  price?: { amount: number; currency: 'XOF' | 'SAT' } | undefined;
  status?: 'active' | 'hidden' | 'archived' | undefined;
  /**
   * The full image list, in order: keys of this product's current images to keep, and new upload keys. An empty
   * list removes every image.
   */
  image_keys?: string[] | undefined;
}

/** A vendor changes a product. A price change is audited with the old price, so it can be undone. */
export async function patchProduct(
  ctx: Context,
  vendor: Vendor,
  productId: string,
  patch: ProductPatch,
  actor: string,
) {
  const p = await findVendorProduct(ctx, vendor, productId);
  if (patch.price && patch.price.currency !== vendorSettings(vendor).pricingCurrency) {
    throw new AppError(
      'VALIDATION_FAILED',
      `This shop prices in ${vendorSettings(vendor).pricingCurrency}.`,
      {
        errors: [{ field: 'price.currency', message: 'Wrong currency' }],
      },
    );
  }
  if (patch.price && patch.price.amount <= 0) {
    throw new AppError('VALIDATION_FAILED', 'The price must be positive.', {
      errors: [{ field: 'price.amount', message: 'Must be positive' }],
    });
  }
  if (patch.category_id) await requireOwnCategory(ctx, vendor.id, patch.category_id);
  // Images are processed before the transaction, so a bad photo changes nothing.
  let images: PreparedImage[] | null = null;
  if (patch.image_keys) {
    const current = await ctx.db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, p.id));
    const byKey = new Map(current.map((i) => [i.storageKey, i]));
    images = [];
    for (const key of [...new Set(patch.image_keys)]) {
      const kept = byKey.get(key);
      images.push(
        kept
          ? {
              storageKey: kept.storageKey,
              width: kept.width,
              height: kept.height,
              dominant: kept.dominant ?? '#cccccc',
            }
          : await processUpload(ctx.media, vendor.id, key),
      );
    }
  }
  const now = ctx.now();
  const updated = await ctx.db.transaction(async (tx) => {
    if (images) {
      await tx.delete(productImages).where(eq(productImages.productId, p.id));
      await insertImages(tx, p.id, images);
    }
    const [row] = await tx
      .update(products)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.category_id !== undefined ? { categoryId: patch.category_id } : {}),
        ...(patch.price ? { priceAmount: patch.price.amount } : {}),
        ...(patch.status ? { status: patch.status } : {}),
        updatedAt: now,
      })
      .where(and(eq(products.id, p.id), eq(products.vendorId, vendor.id)))
      .returning();
    if (patch.price && patch.price.amount !== p.priceAmount) {
      const changePct = Math.round(
        (Math.abs(patch.price.amount - p.priceAmount) / p.priceAmount) * 100,
      );
      await audit(tx, {
        actor,
        action: 'price.changed',
        target: p.id,
        details: {
          from: p.priceAmount,
          to: patch.price.amount,
          currency: p.priceCurrency,
          change_pct: changePct,
        },
      });
    }
    if (patch.status && patch.status !== p.status) {
      await audit(tx, {
        actor,
        action: 'product.status_changed',
        target: p.id,
        details: { from: p.status, to: patch.status },
      });
    }
    return row as Product;
  });
  return vendorProductView(ctx, updated);
}
