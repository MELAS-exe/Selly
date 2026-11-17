import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { actorOf } from '../catalog';
import { vendorVariantView } from '../catalog/internal';
import { findVendorById, isUuid } from '../catalog/store';
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

// The only writer of stock columns (architecture.md 4.6). Internal route for the vendor assistant.
// TODO (Dev 3): the dashboard route POST /api/v1/inventory/variants/{id}/adjustments comes with sign-in.
export const inventoryModule: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string; variant_id: string } }>(
    '/internal/v1/vendors/:id/variants/:variant_id/adjustments',
    async (req, reply) => {
      const body = adjustmentBody.parse(req.body);
      const ctx = app.ctx;
      const vendor = await findVendorById(ctx, req.params.id);
      if (!isUuid(req.params.variant_id)) throw new AppError('NOT_FOUND', 'No such variant.');

      // The variant must belong to this vendor.
      const [owned] = await ctx.db
        .select({ v: core.productVariants, p: core.products })
        .from(core.productVariants)
        .innerJoin(core.products, eq(core.products.id, core.productVariants.productId))
        .where(
          and(
            eq(core.productVariants.id, req.params.variant_id),
            eq(core.products.vendorId, vendor.id),
          ),
        );
      if (!owned) throw new AppError('NOT_FOUND', 'No such variant.');

      const actor = actorOf(req.headers['x-actor'], vendor.id);
      const change =
        body.set_to !== undefined ? { setTo: body.set_to } : { delta: body.delta as number };
      const res = await ctx.db.transaction((tx) =>
        adjust(tx, owned.v.id, change, body.reason, actor),
      );
      return reply.code(201).send({
        variant: vendorVariantView(owned.p, res.variant),
        movement: {
          id: res.movement.id,
          delta_on_hand: res.movement.deltaOnHand,
          reason: res.movement.reason,
          created_at: iso(res.movement.createdAt),
        },
      });
    },
  );
};
