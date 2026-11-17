import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { withIdempotency } from '../../idempotency';
import { iso } from '../../util';
import { requireVendor } from '../auth/http';
import { actorOf } from '../catalog';
import { vendorVariantView } from '../catalog/internal';
import { findVendorById, isUuid, type Vendor } from '../catalog/store';
import {
  confirmBody,
  confirmDraft,
  createRestockDraft,
  discardDraft,
  draftView,
  findDraft,
  findDraftById,
  listDrafts,
  upsertBody,
  upsertDraft,
} from './drafts';
import { adjust } from './service';

const restockBody = z.strictObject({
  image_keys: z.array(z.string().max(200)).min(1).max(6),
  text: z.string().max(1000).optional(),
});
const draftsQuery = z.object({
  status: z.enum(['processing', 'needs_review', 'confirmed', 'discarded', 'failed']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const adjustmentBody = z
  .strictObject({
    delta: z.number().int().min(-10_000).max(10_000).optional(),
    set_to: z.number().int().min(0).max(100_000).optional(),
    reason: z.enum(['restock', 'adjustment']),
  })
  .refine(
    (b) => (b.delta === undefined) !== (b.set_to === undefined),
    'Give exactly one of delta and set_to.',
  );

/** A stock change on a variant of this vendor. on_hand never goes below what pending orders hold. */
async function adjustForVendor(
  ctx: Context,
  vendor: Vendor,
  variantId: string,
  raw: unknown,
  actor: string,
) {
  const body = adjustmentBody.parse(raw);
  if (!isUuid(variantId)) throw new AppError('NOT_FOUND', 'No such variant.');
  const [owned] = await ctx.db
    .select({ v: core.productVariants, p: core.products })
    .from(core.productVariants)
    .innerJoin(core.products, eq(core.products.id, core.productVariants.productId))
    .where(and(eq(core.productVariants.id, variantId), eq(core.products.vendorId, vendor.id)));
  if (!owned) throw new AppError('NOT_FOUND', 'No such variant.');
  const change =
    body.set_to !== undefined ? { setTo: body.set_to } : { delta: body.delta as number };
  const res = await ctx.db.transaction((tx) => adjust(tx, owned.v.id, change, body.reason, actor));
  return {
    variant: vendorVariantView(owned.p, res.variant),
    movement: {
      id: res.movement.id,
      delta_on_hand: res.movement.deltaOnHand,
      reason: res.movement.reason,
      created_at: iso(res.movement.createdAt),
    },
  };
}

// The only writer of stock columns (architecture.md 4.6): the vendor assistant's route and the dashboard's.
export const inventoryModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  app.post<{ Params: { id: string; variant_id: string } }>(
    '/internal/v1/vendors/:id/variants/:variant_id/adjustments',
    async (req, reply) => {
      const vendor = await findVendorById(ctx(), req.params.id);
      const res = await adjustForVendor(
        ctx(),
        vendor,
        req.params.variant_id,
        req.body,
        actorOf(req.headers['x-actor'], vendor.id),
      );
      return reply.code(201).send(res);
    },
  );

  app.post<{ Params: { variant_id: string } }>(
    '/api/v1/inventory/variants/:variant_id/adjustments',
    async (req, reply) => {
      const s = await requireVendor(ctx(), req);
      const vendor = await findVendorById(ctx(), s.vendorId);
      return reply
        .code(201)
        .send(
          await adjustForVendor(
            ctx(),
            vendor,
            req.params.variant_id,
            req.body,
            `vendor:${vendor.id}`,
          ),
        );
    },
  );
  // ----------------------------------------------------------------------------------- drafts from photos

  app.post('/api/v1/inventory/restock-ai', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const body = restockBody.parse(req.body);
    const vendor = await findVendorById(ctx(), s.vendorId);
    const res = await withIdempotency(
      ctx(),
      `restock-ai:${vendor.id}`,
      req.headers['idempotency-key'] as string | undefined,
      body,
      async () => ({ status: 202, body: await createRestockDraft(ctx(), vendor, body) }),
    );
    return reply.code(res.status).send(res.body);
  });

  app.get('/api/v1/inventory/drafts', async (req) => {
    const s = await requireVendor(ctx(), req);
    return listDrafts(ctx(), s.vendorId, draftsQuery.parse(req.query));
  });

  app.get<{ Params: { id: string } }>('/api/v1/inventory/drafts/:id', async (req) => {
    const s = await requireVendor(ctx(), req);
    return draftView(ctx(), await findDraft(ctx(), s.vendorId, req.params.id));
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/inventory/drafts/:id/confirm',
    async (req, reply) => {
      const s = await requireVendor(ctx(), req);
      const body = confirmBody.parse(req.body);
      const vendor = await findVendorById(ctx(), s.vendorId);
      const d = await findDraft(ctx(), vendor.id, req.params.id);
      return reply
        .code(201)
        .send(await confirmDraft(ctx(), vendor, d, body, `vendor:${vendor.id}`));
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/inventory/drafts/:id/discard',
    async (req, reply) => {
      const s = await requireVendor(ctx(), req);
      await discardDraft(ctx(), s.vendorId, req.params.id, `vendor:${s.vendorId}`);
      return reply.code(204).send();
    },
  );

  // The agent: a draft from the assistant chat, or the extraction of a dashboard draft.
  app.post<{ Params: { id: string } }>(
    '/internal/v1/vendors/:id/product-drafts',
    async (req, reply) => {
      const body = upsertBody.parse(req.body);
      const vendor = await findVendorById(ctx(), req.params.id);
      return reply
        .code(201)
        .send(await upsertDraft(ctx(), vendor, body, actorOf(req.headers['x-actor'], vendor.id)));
    },
  );

  // The path names only the draft (api.json); the draft names its vendor.
  app.post<{ Params: { id: string } }>(
    '/internal/v1/product-drafts/:id/confirm',
    async (req, reply) => {
      const body = confirmBody.parse(req.body);
      const d = await findDraftById(ctx(), req.params.id);
      const vendor = await findVendorById(ctx(), d.vendorId);
      return reply
        .code(201)
        .send(
          await confirmDraft(ctx(), vendor, d, body, actorOf(req.headers['x-actor'], vendor.id)),
        );
    },
  );
};
