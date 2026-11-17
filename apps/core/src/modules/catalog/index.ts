import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { findVendorBySlug, listProducts, productDetail, storeProfile, storeStatus } from './store';

const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=300';
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
};
