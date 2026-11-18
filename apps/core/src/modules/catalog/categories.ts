// A vendor's own categories: a short named list used to group products on the storefront and in the dashboard
// (architecture.md section 4.3, products.category_id). Deleting a category never deletes its products: they fall
// back to uncategorised, same as if the vendor had not chosen one.
import { core } from '@selly/db';
import { and, asc, eq, max } from '@selly/db/orm';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { isUuid, type Vendor } from './store';

const { categories, products } = core;
export type Category = typeof categories.$inferSelect;

const RESERVED_SLUG = 'all';

/** "Sacs à main" becomes "sacs-a-main": what a storefront link uses, /s/{store}?category={slug}. */
export function slugifyCategory(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 1 ? s : 'categorie';
}

async function freeSlug(ctx: Context, vendorId: string, base: string, skipId?: string) {
  const taken = await ctx.db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(eq(categories.vendorId, vendorId));
  const used = new Set(taken.filter((t) => t.id !== skipId).map((t) => t.slug));
  if (base !== RESERVED_SLUG && !used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function categoryView(c: Category) {
  return { id: c.id, name: c.name, slug: c.slug, position: c.position };
}

export async function listCategories(ctx: Context, vendorId: string) {
  const rows = await ctx.db
    .select()
    .from(categories)
    .where(eq(categories.vendorId, vendorId))
    .orderBy(asc(categories.position), asc(categories.name));
  return rows.map(categoryView);
}

/** Throws 404 when the category does not exist or belongs to another shop: never leaks another shop's ids. */
export async function requireOwnCategory(ctx: Context, vendorId: string, categoryId: string) {
  if (!isUuid(categoryId)) throw new AppError('NOT_FOUND', 'No such category.');
  const [row] = await ctx.db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.vendorId, vendorId)));
  if (!row) throw new AppError('NOT_FOUND', 'No such category.');
  return row;
}

export async function createCategory(ctx: Context, vendor: Vendor, name: string) {
  const trimmed = name.trim();
  const [{ n } = { n: null }] = await ctx.db
    .select({ n: max(categories.position) })
    .from(categories)
    .where(eq(categories.vendorId, vendor.id));
  const slug = await freeSlug(ctx, vendor.id, slugifyCategory(trimmed));
  const [row] = await ctx.db
    .insert(categories)
    .values({ vendorId: vendor.id, name: trimmed, slug, position: (n ?? -1) + 1 })
    .returning();
  return categoryView(row as Category);
}

/**
 * A category id for a name the vision model read from a photo (architecture.md section 8.6): an existing category
 * of this vendor with the same name (case and accents folded), or a new one. Never fails the draft over a category.
 */
export async function categoryIdForName(
  ctx: Context,
  vendor: Vendor,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const slug = slugifyCategory(trimmed);
  const [existing] = await ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.vendorId, vendor.id), eq(categories.slug, slug)));
  if (existing) return existing.id;
  const created = await createCategory(ctx, vendor, trimmed);
  return created.id;
}

export async function renameCategory(
  ctx: Context,
  vendor: Vendor,
  categoryId: string,
  name: string,
) {
  const current = await requireOwnCategory(ctx, vendor.id, categoryId);
  const trimmed = name.trim();
  const slug =
    trimmed === current.name
      ? current.slug
      : await freeSlug(ctx, vendor.id, slugifyCategory(trimmed), categoryId);
  const [row] = await ctx.db
    .update(categories)
    .set({ name: trimmed, slug })
    .where(eq(categories.id, categoryId))
    .returning();
  return categoryView(row as Category);
}

/** New positions, lowest first: every category of this vendor must be listed, once each. */
export async function reorderCategories(ctx: Context, vendor: Vendor, orderedIds: string[]) {
  const existing = await ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.vendorId, vendor.id));
  const have = new Set(existing.map((c) => c.id));
  const given = new Set(orderedIds);
  if (have.size !== given.size || [...have].some((id) => !given.has(id)))
    throw new AppError(
      'VALIDATION_FAILED',
      'The list must name every category of this shop, once each.',
    );
  await ctx.db.transaction(async (tx) => {
    for (const [position, id] of orderedIds.entries())
      await tx.update(categories).set({ position }).where(eq(categories.id, id));
  });
  return listCategories(ctx, vendor.id);
}

/** Products in this category fall back to uncategorised; they are never deleted or hidden. */
export async function deleteCategory(ctx: Context, vendor: Vendor, categoryId: string) {
  await requireOwnCategory(ctx, vendor.id, categoryId);
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(products)
      .set({ categoryId: null })
      .where(and(eq(products.categoryId, categoryId), eq(products.vendorId, vendor.id)));
    await tx.delete(categories).where(eq(categories.id, categoryId));
  });
}
