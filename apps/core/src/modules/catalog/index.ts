import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { findVendorProduct, patchProduct, searchProducts } from './internal';
import {
  findVendorById,
  findVendorBySlug,
  isUuid,
  listProducts,
  productDetail,
  storeProfile,
  storeStatus,
} from './store';

const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=300';
const searchQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  size: z.string().trim().min(1).max(20).optional(),
  color: z.string().trim().min(1).max(30).optional(),
  max_price_xof: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(5).default(5),
});
const moneyIn = z.object({ amount: z.number().int(), currency: z.enum(['XOF', 'SAT']) });
const productPatch = z
  .strictObject({
    title: z.string().min(2).max(120).optional(),
    description: z.string().max(2000).optional(),
    category: z.string().max(60).optional(),
    price: moneyIn.optional(),
    status: z.enum(['active', 'hidden', 'archived']).optional(),
    image_keys: z.array(z.string()).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
const page = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Public storefront reads: store profile, catalog pages, product detail (architecture.md 3.4, 5.2 group A).
export const catalogModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  app.get<{ Params: { slug: string } }>('/api/v1/stores/:slug', async (req, reply) => {
    const vendor = await findVendorBySlug(ctx(), req.params.slug);
    const store = await storeProfile(ctx(), vendor);
    const q = page.parse(req.query);
    const products =
      store.status === 'active'
        ? await listProducts(ctx(), vendor.id, q)
        : { data: [], next_cursor: null };
    reply.header('Cache-Control', PUBLIC_CACHE);
    return { store, products: products.data, next_cursor: products.next_cursor };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/stores/:slug/products', async (req, reply) => {
    const vendor = await findVendorBySlug(ctx(), req.params.slug);
    reply.header('Cache-Control', PUBLIC_CACHE);
    if ((await storeStatus(ctx(), vendor)) !== 'active') return { data: [], next_cursor: null };
    return listProducts(ctx(), vendor.id, page.parse(req.query));
  });

  app.get<{ Params: { slug: string; product_id: string } }>(
    '/api/v1/stores/:slug/products/:product_id',
    async (req, reply) => {
      const vendor = await findVendorBySlug(ctx(), req.params.slug);
      const { variant_id } = z.object({ variant_id: z.uuid().optional() }).parse(req.query);
      reply.header('Cache-Control', PUBLIC_CACHE);
      return productDetail(ctx(), vendor, req.params.product_id, variant_id);
    },
  );

  // ----------------------------------------------------------------------------------- internal (agent)

  app.get<{ Params: { id: string } }>('/internal/v1/vendors/:id/products/search', async (req) => {
    const q = searchQuery.parse(req.query);
    const vendor = await findVendorById(ctx(), req.params.id);
    return searchProducts(ctx(), vendor, {
      q: q.q,
      size: q.size,
      color: q.color,
      maxPriceXof: q.max_price_xof,
      limit: q.limit,
    });
  });

  // Exact stock for every variant. Scoped to the vendor: a product of another shop is a 404.
  app.get<{ Params: { id: string; product_id: string } }>(
    '/internal/v1/vendors/:id/products/:product_id',
    async (req) => {
      const vendor = await findVendorById(ctx(), req.params.id);
      if (!isUuid(req.params.product_id)) throw new AppError('NOT_FOUND', 'No such product.');
      return productDetail(ctx(), vendor, req.params.product_id, 'all');
    },
  );

  // The vendor's price or status command from the assistant.
  app.patch<{ Params: { id: string; product_id: string } }>(
    '/internal/v1/vendors/:id/products/:product_id',
    async (req) => {
      const body = productPatch.parse(req.body);
      if (body.image_keys) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Images cannot be changed here yet: the media pipeline is not built.',
          {
            errors: [{ field: 'image_keys', message: 'Not supported yet' }],
          },
        );
      }
      const vendor = await findVendorById(ctx(), req.params.id);
      await findVendorProduct(ctx(), vendor, req.params.product_id);
      return patchProduct(
        ctx(),
        vendor,
        req.params.product_id,
        body,
        actorOf(req.headers['x-actor'], vendor.id),
      );
    },
  );
};

/** X-Actor from the agent, for the audit log. Only a vendor actor of this vendor is believed. */
export function actorOf(header: string | string[] | undefined, vendorId: string): string {
  const h = Array.isArray(header) ? header[0] : header;
  return h === `vendor:${vendorId}` ? h : 'agent';
}
