import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { withIdempotency } from '../../idempotency';
import { currentSession, requireVendor } from '../auth/http';
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from './categories';
import { findVendorProduct, patchProduct, searchProducts } from './internal';
import {
  findVendorById,
  findVendorBySlug,
  isUuid,
  listProducts,
  productDetail,
  storeProfile,
  storeStatus,
  type Vendor,
} from './store';
import { createVendorProduct, listVendorProducts } from './vendor';

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
    category_id: z.uuid().nullable().optional(),
    price: moneyIn.optional(),
    status: z.enum(['active', 'hidden', 'archived']).optional(),
    image_keys: z.array(z.string().max(200)).max(8).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');
const page = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Public storefront reads: store profile, catalog pages, product detail (architecture.md 3.4, 5.2 group A).
const moneyStrict = z.strictObject({
  amount: z.number().int().positive(),
  currency: z.enum(['XOF', 'SAT']),
});
const productCreate = z.strictObject({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(2000).optional(),
  category_id: z.uuid().optional(),
  price: moneyStrict,
  image_keys: z.array(z.string()).max(8).optional(),
  variants: z
    .array(
      z.strictObject({
        options: z.record(z.string().regex(/^[a-z_]{1,20}$/), z.string().trim().min(1).max(40)),
        price_override: moneyStrict.optional(),
        on_hand: z.number().int().min(0).max(100_000),
      }),
    )
    .min(1)
    .max(50),
});
const inventoryQuery = z.object({
  status: z.enum(['active', 'hidden', 'archived']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const categoryBody = z.strictObject({ name: z.string().trim().min(1).max(40) });
const reorderBody = z.strictObject({ ids: z.array(z.uuid()).min(1).max(200) });

export const catalogModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  /**
   * Who sees the catalog: everyone when the shop is published; only its owner, in preview, when it is not (no
   * wallet yet, trial over, plan suspended). A preview is never cached by a CDN or shared.
   */
  async function access(req: FastifyRequest, reply: FastifyReply, vendor: Vendor) {
    if ((await storeStatus(ctx(), vendor)) === 'active') {
      reply.header('Cache-Control', PUBLIC_CACHE);
      return { open: true, preview: false };
    }
    const owner = (await currentSession(ctx(), req))?.vendorId === vendor.id;
    reply.header('Cache-Control', owner ? 'private, no-store' : PUBLIC_CACHE);
    return { open: owner, preview: owner };
  }

  app.get<{ Params: { slug: string } }>('/api/v1/stores/:slug', async (req, reply) => {
    const vendor = await findVendorBySlug(ctx(), req.params.slug);
    const store = await storeProfile(ctx(), vendor);
    const q = page.parse(req.query);
    const { open, preview } = await access(req, reply, vendor);
    const products = open
      ? await listProducts(ctx(), vendor.id, q)
      : { data: [], next_cursor: null };
    return {
      store,
      products: products.data,
      next_cursor: products.next_cursor,
      ...(preview ? { preview: true } : {}),
    };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/stores/:slug/products', async (req, reply) => {
    const vendor = await findVendorBySlug(ctx(), req.params.slug);
    if (!(await access(req, reply, vendor)).open) return { data: [], next_cursor: null };
    return listProducts(ctx(), vendor.id, page.parse(req.query));
  });

  app.get<{ Params: { slug: string; product_id: string } }>(
    '/api/v1/stores/:slug/products/:product_id',
    async (req, reply) => {
      const vendor = await findVendorBySlug(ctx(), req.params.slug);
      const { variant_id } = z.object({ variant_id: z.uuid().optional() }).parse(req.query);
      // A shop that is not published shows no products, not even by direct link, except to its owner.
      if (!(await access(req, reply, vendor)).open)
        throw new AppError('STORE_PAUSED', 'This shop is temporarily closed.');
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

  // ----------------------------------------------------------------------------------- the vendor's dashboard

  app.get('/api/v1/inventory', async (req) => {
    const s = await requireVendor(ctx(), req);
    return listVendorProducts(
      ctx(),
      await findVendorById(ctx(), s.vendorId),
      inventoryQuery.parse(req.query),
    );
  });

  app.post('/api/v1/inventory', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const body = productCreate.parse(req.body);
    const vendor = await findVendorById(ctx(), s.vendorId);
    const res = await withIdempotency(
      ctx(),
      `vendor:${vendor.id}`,
      req.headers['idempotency-key'] as string | undefined,
      body,
      async () => ({
        status: 201,
        body: await createVendorProduct(ctx(), vendor, {
          title: body.title,
          description: body.description,
          categoryId: body.category_id,
          price: body.price,
          image_keys: body.image_keys,
          variants: body.variants,
        }),
      }),
    );
    return reply.code(res.status).send(res.body);
  });

  app.patch<{ Params: { product_id: string } }>('/api/v1/inventory/:product_id', async (req) => {
    const s = await requireVendor(ctx(), req);
    const body = productPatch.parse(req.body);
    const vendor = await findVendorById(ctx(), s.vendorId);
    return patchProduct(ctx(), vendor, req.params.product_id, body, `vendor:${vendor.id}`);
  });

  // ----------------------------------------------------------------------------------- categories

  app.get('/api/v1/vendors/me/categories', async (req) => {
    const s = await requireVendor(ctx(), req);
    return { data: await listCategories(ctx(), s.vendorId) };
  });

  app.post('/api/v1/vendors/me/categories', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const body = categoryBody.parse(req.body);
    const vendor = await findVendorById(ctx(), s.vendorId);
    return reply.code(201).send(await createCategory(ctx(), vendor, body.name));
  });

  app.put('/api/v1/vendors/me/categories/order', async (req) => {
    const s = await requireVendor(ctx(), req);
    const body = reorderBody.parse(req.body);
    const vendor = await findVendorById(ctx(), s.vendorId);
    return { data: await reorderCategories(ctx(), vendor, body.ids) };
  });

  app.patch<{ Params: { category_id: string } }>(
    '/api/v1/vendors/me/categories/:category_id',
    async (req) => {
      const s = await requireVendor(ctx(), req);
      const body = categoryBody.parse(req.body);
      const vendor = await findVendorById(ctx(), s.vendorId);
      return renameCategory(ctx(), vendor, req.params.category_id, body.name);
    },
  );

  app.delete<{ Params: { category_id: string } }>(
    '/api/v1/vendors/me/categories/:category_id',
    async (req, reply) => {
      const s = await requireVendor(ctx(), req);
      const vendor = await findVendorById(ctx(), s.vendorId);
      await deleteCategory(ctx(), vendor, req.params.category_id);
      return reply.code(204).send();
    },
  );
};

/** X-Actor from the agent, for the audit log. Only a vendor actor of this vendor is believed. */
export function actorOf(header: string | string[] | undefined, vendorId: string): string {
  const h = Array.isArray(header) ? header[0] : header;
  return h === `vendor:${vendorId}` ? h : 'agent';
}
