import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { requireVendor } from '../auth/http';
import { actorOf } from '../catalog';
import { vendorVariantView } from '../catalog/internal';
import { findVendorById, isUuid, type Vendor } from '../catalog/store';
import { adjust } from './service';

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
};
