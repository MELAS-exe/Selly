// Product drafts from photos (architecture.md sections 5.3.6, 6.5 and 8.6, ADR-12).
// A draft is what the vision model read from the vendor's photos and words. Nothing reaches the catalog until the
// vendor confirms it; confirming creates the product (mode new) or adds the stock to an existing one (mode restock)
// in one transaction.
//
// Two ways in:
// - dashboard: POST /inventory/restock-ai creates a `processing` draft and asks the agent (outbox draft.requested);
//   the agent sends the extraction back with POST /internal/v1/vendors/{id}/product-drafts and a draft_id.
// - assistant: the agent already extracted in the chat and creates the draft directly, in `needs_review`.
// Each new draft counts one photo draft against the plan, once (the usage reference is the draft id).
import { core } from '@selly/db';
import { and, desc, eq, inArray, lt, ne, or, sql } from '@selly/db/orm';
import { z } from 'zod';
import type { Context, Database } from '../../context';
import { AppError } from '../../errors';
import { decodeCursor, encodeCursor, iso } from '../../util';
import { findVendorProduct, vendorProductView } from '../catalog/internal';
import { isUuid, type Vendor } from '../catalog/store';
import { createVendorProduct } from '../catalog/vendor';
import { notifyVendor } from '../events/notifications';
import { audit, publishEvent } from '../events/outbox';
import { isUploadKeyOf } from '../media/images';
import {
  currentSubscription,
  isServing,
  reportUsage,
  usageThisMonth,
} from '../subscriptions/service';
import * as inventory from './service';

const { productDrafts: drafts, products, productVariants: pv } = core;
type Draft = typeof drafts.$inferSelect;
type Status = Draft['status'];

/** A draft the agent never answered for is failed after this long, so the dashboard stops waiting. */
export const DRAFT_PROCESSING_TIMEOUT_MS = 10 * 60_000;
/** The agent's vision model reads private uploads through these links. */
const IMAGE_LINK_SECONDS = 60 * 60;
const OPEN: Status[] = ['processing', 'needs_review'];

export interface DraftQuestion {
  id: string;
  text: string;
  choices: string[];
}

// ---------------------------------------------------------------------------------------------- views

async function matchesFor(ctx: Context, d: Draft) {
  const title = (d.extracted?.title as { value?: unknown } | undefined)?.value;
  if (typeof title !== 'string' || title.trim().length < 2) return [];
  const score = sql<number>`similarity(public.unaccent_i(${products.title}), public.unaccent_i(${title}))`;
  const rows = await ctx.db
    .select({ id: products.id, title: products.title, similarity: score })
    .from(products)
    .where(
      and(eq(products.vendorId, d.vendorId), ne(products.status, 'archived'), sql`${score} > 0.3`),
    )
    .orderBy(desc(score))
    .limit(3);
  return rows.map((r) => ({
    product_id: r.id,
    title: r.title,
    similarity: Math.round(Number(r.similarity) * 100) / 100,
  }));
}

export async function draftView(ctx: Context, d: Draft) {
  return {
    id: d.id,
    status: d.status,
    source: d.source,
    image_keys: d.imageKeys,
    input_text: d.inputText,
    extracted: d.extracted,
    questions: d.questions as DraftQuestion[],
    matches: d.status === 'needs_review' ? await matchesFor(ctx, d) : [],
    created_at: iso(d.createdAt) as string,
    confirmed_at: iso(d.confirmedAt),
  };
}

export async function findDraft(ctx: Context, vendorId: string, id: string): Promise<Draft> {
  if (!isUuid(id)) throw new AppError('NOT_FOUND', 'No such draft.');
  const [d] = await ctx.db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.vendorId, vendorId)));
  if (!d) throw new AppError('NOT_FOUND', 'No such draft.');
  return d;
}

/** For the agent's confirm route, which names the draft only: the draft says which vendor it belongs to. */
export async function findDraftById(ctx: Context, id: string): Promise<Draft> {
  if (!isUuid(id)) throw new AppError('NOT_FOUND', 'No such draft.');
  const [d] = await ctx.db.select().from(drafts).where(eq(drafts.id, id));
  if (!d) throw new AppError('NOT_FOUND', 'No such draft.');
  return d;
}

/** Newest first. Without a status: the drafts still open (processing or waiting for review). */
export async function listDrafts(
  ctx: Context,
  vendorId: string,
  q: { status?: Status | undefined; cursor?: string | undefined; limit: number },
) {
  const conds = [
    eq(drafts.vendorId, vendorId),
    q.status ? eq(drafts.status, q.status) : inArray(drafts.status, OPEN),
  ];
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      or(
        lt(drafts.createdAt, c.at),
        and(eq(drafts.createdAt, c.at), lt(drafts.id, c.id)),
      ) as ReturnType<typeof eq>,
    );
  }
  const rows = await ctx.db
    .select()
    .from(drafts)
    .where(and(...conds))
    .orderBy(desc(drafts.createdAt), desc(drafts.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    data: await Promise.all(page.map((d) => draftView(ctx, d))),
    next_cursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

// ---------------------------------------------------------------------------------------------- creation

/** A new draft needs a shop that is open and photo drafts left this month. */
async function requireDraftQuota(ctx: Context, vendorId: string) {
  const sub = await currentSubscription(ctx, vendorId);
  const limit = isServing(sub) ? (sub?.limits.drafts_per_month ?? 0) : 0;
  const used = (await usageThisMonth(ctx.db, vendorId, ctx.now())).drafts;
  if (used >= limit)
    throw new AppError(
      'PLAN_LIMIT_REACHED',
      isServing(sub)
        ? `Your plan allows ${limit} photo drafts per month. You have used ${used}.`
        : 'Choose a plan to create products from photos.',
      { errors: [{ limit: 'drafts', used, max: limit }] },
    );
}

/** Image keys must be this vendor's uploads, already in storage. */
async function checkImageKeys(ctx: Context, vendorId: string, keys: string[]) {
  for (const key of keys) {
    const ok = isUploadKeyOf(key, vendorId) && (await ctx.media.head('private', key)) !== null;
    if (!ok)
      throw new AppError('VALIDATION_FAILED', `Image ${key} is not an upload of this shop.`, {
        errors: [{ field: 'image_keys', key, message: 'Unknown upload' }],
      });
  }
}

/** The dashboard's photo button: a draft in `processing`, extracted by the agent in the background. */
export async function createRestockDraft(
  ctx: Context,
  vendor: Vendor,
  input: { image_keys: string[]; text?: string | undefined },
) {
  const keys = [...new Set(input.image_keys)];
  await checkImageKeys(ctx, vendor.id, keys);
  await requireDraftQuota(ctx, vendor.id);
  const now = ctx.now();
  const imageUrls = await Promise.all(keys.map((k) => ctx.media.presignGet(k, IMAGE_LINK_SECONDS)));
  const draft = await ctx.db.transaction(async (tx) => {
    const [d] = await tx
      .insert(drafts)
      .values({
        vendorId: vendor.id,
        source: 'dashboard',
        imageKeys: keys,
        inputText: input.text ?? null,
        status: 'processing',
        createdAt: now,
      })
      .returning();
    const created = d as Draft;
    await publishEvent(tx, {
      type: 'draft.requested',
      vendorId: vendor.id,
      key: created.id,
      data: {
        draft_id: created.id,
        image_keys: keys,
        image_urls: imageUrls,
        input_text: input.text ?? null,
      },
      now,
    });
    return created;
  });
  await reportUsage(ctx, vendor.id, { metric: 'drafts', quantity: 1, reference: draft.id });
  return draftView(ctx, draft);
}

export const upsertBody = z.strictObject({
  draft_id: z.uuid().nullable().optional(),
  image_keys: z.array(z.string().max(200)).max(6),
  input_text: z.string().max(1000).optional(),
  extracted: z.record(z.string(), z.unknown()).optional(),
  questions: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(40),
        text: z.string().min(1).max(300),
        choices: z.array(z.string().max(100)).max(6),
      }),
    )
    .max(5)
    .optional(),
});

/**
 * The agent's side. Without draft_id: a new draft from the assistant chat, counted against the plan. With draft_id:
 * the extraction of a dashboard draft, or new answers and fields for an open draft.
 */
export async function upsertDraft(
  ctx: Context,
  vendor: Vendor,
  body: z.infer<typeof upsertBody>,
  actor: string,
) {
  const keys = [...new Set(body.image_keys)];
  await checkImageKeys(ctx, vendor.id, keys);
  const now = ctx.now();

  if (!body.draft_id) {
    await requireDraftQuota(ctx, vendor.id);
    const [d] = await ctx.db
      .insert(drafts)
      .values({
        vendorId: vendor.id,
        source: 'assistant',
        imageKeys: keys,
        inputText: body.input_text ?? null,
        extracted: body.extracted ?? null,
        questions: body.questions ?? [],
        status: body.extracted ? 'needs_review' : 'processing',
        createdAt: now,
      })
      .returning();
    const created = d as Draft;
    await reportUsage(ctx, vendor.id, { metric: 'drafts', quantity: 1, reference: created.id });
    return draftView(ctx, created);
  }

  const current = await findDraft(ctx, vendor.id, body.draft_id);
  const updated = await ctx.db.transaction(async (tx) => {
    const [d] = await tx
      .update(drafts)
      .set({
        imageKeys: keys.length > 0 ? keys : current.imageKeys,
        ...(body.input_text !== undefined ? { inputText: body.input_text } : {}),
        ...(body.extracted !== undefined ? { extracted: body.extracted } : {}),
        ...(body.questions !== undefined ? { questions: body.questions } : {}),
        status: body.extracted || current.extracted ? 'needs_review' : current.status,
        error: null,
      })
      .where(and(eq(drafts.id, current.id), inArray(drafts.status, [...OPEN, 'failed'])))
      .returning();
    if (!d) throw new AppError('NOT_FOUND', 'This draft is no longer open.');
    // The dashboard was waiting for this one.
    if (current.status !== 'needs_review' && d.status === 'needs_review')
      await notifyVendor(tx, {
        vendorId: vendor.id,
        type: 'draft.ready',
        data: { draft_id: d.id, status: d.status },
        now,
      });
    await audit(tx, { actor, action: 'draft.updated', target: d.id });
    return d;
  });
  return draftView(ctx, updated);
}

// ---------------------------------------------------------------------------------------------- confirm

export const confirmBody = z.strictObject({
  answers: z.record(z.string(), z.string().max(200)).optional(),
  edits: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(['new', 'restock']),
  target_product_id: z.uuid().nullable().optional(),
});
type ConfirmInput = z.infer<typeof confirmBody>;

const money = z.object({ amount: z.number().int().positive(), currency: z.enum(['XOF', 'SAT']) });
const variantIn = z.object({
  options: z.record(z.string(), z.string().nullable()).default({}),
  stock: z.number().int().min(0).max(100_000).nullable(),
});
const merged = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  price: money.nullable().optional(),
  variants: z.array(variantIn).max(50).default([]),
});

/** A field as the vendor confirmed it: an edit wins over what the model read. */
function fieldOf(d: Draft, edits: Record<string, unknown>, name: string): unknown {
  if (edits[name] !== undefined) return edits[name];
  const f = d.extracted?.[name];
  return f && typeof f === 'object' && 'value' in f ? (f as { value: unknown }).value : f;
}

/**
 * Stock left open by the model ("5 paires du 40 au 44") is filled from the vendor's answer when it says so plainly:
 * "5 par pointure" (each) or "5 au total" (spread evenly, the remainder on the first sizes). Anything else must come
 * as an edit.
 */
function fillStock(variants: { stock: number | null }[], answers: Record<string, string>) {
  if (!variants.some((v) => v.stock === null)) return;
  for (const a of Object.values(answers)) {
    const each = /^\s*(\d{1,6})\s+par\b/i.exec(a);
    const total = /^\s*(\d{1,6})\s+au total\b/i.exec(a);
    if (each) {
      for (const v of variants) if (v.stock === null) v.stock = Number(each[1]);
      return;
    }
    if (total) {
      const open = variants.filter((v) => v.stock === null);
      const n = Number(total[1]);
      open.forEach((v, i) => {
        v.stock = Math.floor(n / open.length) + (i < n % open.length ? 1 : 0);
      });
      return;
    }
  }
}

const optionKey = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort());

function resolve(d: Draft, input: ConfirmInput) {
  const answers = input.answers ?? {};
  const open = (d.questions as DraftQuestion[]).filter((q) => !(answers[q.id] ?? '').trim());
  if (open.length > 0)
    throw new AppError('VALIDATION_FAILED', 'Answer the open questions first.', {
      errors: open.map((q) => ({ question_id: q.id, message: q.text })),
    });
  const edits = input.edits ?? {};
  const parsed = merged.safeParse({
    title: fieldOf(d, edits, 'title'),
    description: fieldOf(d, edits, 'description'),
    category: fieldOf(d, edits, 'category'),
    price: fieldOf(d, edits, 'price'),
    variants: fieldOf(d, edits, 'variants') ?? [],
  });
  if (!parsed.success)
    throw new AppError('VALIDATION_FAILED', 'The draft is incomplete.', {
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  const x = parsed.data;
  const variants = (x.variants.length > 0 ? x.variants : [{ options: {}, stock: null }]).map(
    (v) => ({
      options: Object.fromEntries(
        Object.entries(v.options).filter((e): e is [string, string] => !!e[1]?.trim()),
      ),
      stock: v.stock,
    }),
  );
  fillStock(variants, answers);
  const missing = variants.filter((v) => v.stock === null);
  if (missing.length > 0)
    throw new AppError('VALIDATION_FAILED', 'Say how many of each variant are in stock.', {
      errors: missing.map((v) => ({ field: 'variants.stock', options: v.options })),
    });
  for (const v of variants)
    for (const k of Object.keys(v.options))
      if (!/^[a-z_]{1,20}$/.test(k))
        throw new AppError('VALIDATION_FAILED', `Option name "${k}" is not allowed.`, {
          errors: [{ field: 'variants.options', message: 'Lowercase letters and _ only' }],
        });
  if (new Set(variants.map((v) => optionKey(v.options))).size !== variants.length)
    throw new AppError('VALIDATION_FAILED', 'Two variants have the same options.', {
      errors: [{ field: 'variants', message: 'Duplicate options' }],
    });
  return { ...x, variants: variants as { options: Record<string, string>; stock: number }[] };
}

/** Marks the draft confirmed in the caller's transaction; a draft confirmed meanwhile rolls everything back. */
async function claimDraft(tx: Database, d: Draft, now: Date, targetProductId: string) {
  const rows = await tx
    .update(drafts)
    .set({ status: 'confirmed', confirmedAt: now, targetProductId })
    .where(and(eq(drafts.id, d.id), eq(drafts.status, 'needs_review')))
    .returning({ id: drafts.id });
  if (rows.length === 0)
    throw new AppError('NOT_FOUND', 'This draft is no longer waiting for review.');
}

/**
 * Publishes the draft. mode new: a product with its variants, stock and images (the plan's product limit applies).
 * mode restock: the stock is added to target_product_id; a size or colour it does not have yet becomes a variant.
 */
export async function confirmDraft(
  ctx: Context,
  vendor: Vendor,
  d: Draft,
  input: ConfirmInput,
  actor: string,
) {
  if (d.status !== 'needs_review')
    throw new AppError('NOT_FOUND', 'This draft is not waiting for review.');
  const x = resolve(d, input);
  const now = ctx.now();

  if (input.mode === 'new') {
    if (!x.price)
      throw new AppError('VALIDATION_FAILED', 'The draft has no price.', {
        errors: [{ field: 'price', message: 'Required' }],
      });
    return createVendorProduct(
      ctx,
      vendor,
      {
        title: x.title,
        description: x.description ?? undefined,
        category: x.category ?? undefined,
        price: x.price,
        image_keys: d.imageKeys,
        variants: x.variants.map((v) => ({ options: v.options, on_hand: v.stock })),
      },
      {
        actor,
        draftId: d.id,
        inTx: async (tx, product) => {
          await claimDraft(tx, d, now, product.id);
        },
      },
    );
  }

  if (!input.target_product_id)
    throw new AppError('VALIDATION_FAILED', 'Say which product gets the stock.', {
      errors: [{ field: 'target_product_id', message: 'Required for mode restock' }],
    });
  const target = await findVendorProduct(ctx, vendor, input.target_product_id);
  await ctx.db.transaction(async (tx) => {
    await claimDraft(tx, d, now, target.id);
    const existing = await tx.select().from(pv).where(eq(pv.productId, target.id));
    const byOptions = new Map(existing.map((v) => [optionKey(v.options), v]));
    for (const v of x.variants) {
      let id = byOptions.get(optionKey(v.options))?.id;
      if (!id) {
        const [row] = await tx
          .insert(pv)
          .values({ productId: target.id, options: v.options, onHand: 0 })
          .returning({ id: pv.id });
        id = (row as { id: string }).id;
      }
      if (v.stock > 0) await inventory.adjust(tx, id, { delta: v.stock }, 'restock', actor, d.id);
    }
    await tx.update(products).set({ updatedAt: now }).where(eq(products.id, target.id));
    await audit(tx, {
      actor,
      action: 'draft.restocked',
      target: target.id,
      details: { draft_id: d.id, units: x.variants.reduce((n, v) => n + v.stock, 0) },
    });
  });
  return vendorProductView(ctx, target);
}

export async function discardDraft(ctx: Context, vendorId: string, id: string, actor: string) {
  const d = await findDraft(ctx, vendorId, id);
  if (d.status === 'discarded') return;
  if (d.status === 'confirmed')
    throw new AppError('NOT_FOUND', 'This draft is already in the catalog.');
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(drafts)
      .set({ status: 'discarded' })
      .where(and(eq(drafts.id, d.id), ne(drafts.status, 'confirmed')));
    await audit(tx, { actor, action: 'draft.discarded', target: d.id });
  });
}

/** Drafts the agent never answered for: failed, and the dashboard is told. Run with the housekeeping. */
export async function failStaleDrafts(ctx: Context) {
  const now = ctx.now();
  const stale = await ctx.db
    .update(drafts)
    .set({ status: 'failed', error: 'The photo could not be read in time. Try again.' })
    .where(
      and(
        eq(drafts.status, 'processing'),
        lt(drafts.createdAt, new Date(now.getTime() - DRAFT_PROCESSING_TIMEOUT_MS)),
      ),
    )
    .returning({ id: drafts.id, vendorId: drafts.vendorId });
  for (const d of stale)
    await notifyVendor(ctx.db, {
      vendorId: d.vendorId,
      type: 'draft.ready',
      data: { draft_id: d.id, status: 'failed' },
      now,
    });
  return stale.length;
}
