import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { withIdempotency } from '../../idempotency';
import { iso, money } from '../../util';
import { requireVendor } from '../auth/http';
import { actorOf } from '../catalog';
import { findVendorById, findVendorBySlug } from '../catalog/store';
import {
  dashboardMetrics,
  findOrder,
  fulfillOrder,
  listOrders,
  metrics,
  statusView,
} from './internal';
import {
  checkoutStatus,
  checkoutView,
  createOrder,
  findOrderByToken,
  lineMoney,
  quoteCart,
  renewInvoice,
  satsFor,
} from './service';
import {
  cancelVendorOrder,
  findVendorOrderById,
  fulfillVendorOrder,
  listVendorOrders,
  vendorOrderView,
} from './vendor';

const cartItem = z.object({ variant_id: z.uuid(), quantity: z.number().int().min(1).max(50) });
const delivery = z.object({
  method: z.enum(['delivery', 'pickup']),
  zone_id: z.string().max(60).optional(),
  address_text: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});
const moneySchema = z.object({ amount: z.number().int().min(0), currency: z.enum(['XOF', 'SAT']) });
const customer = z.object({
  display_name: z.string().min(2).max(60),
  phone_e164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, 'Use the international format, e.g. +221771234567'),
});
const cartQuoteBody = z.strictObject({ items: z.array(cartItem).min(1).max(20), delivery });
const orderBody = z.strictObject({
  store_slug: z.string(),
  channel: z.literal('web'),
  customer,
  items: z.array(cartItem).min(1).max(20),
  delivery,
  expected_total: moneySchema,
});
const internalQuoteBody = z.strictObject({
  items: z.array(cartItem).min(1).max(20),
  delivery,
  discount_pct: z.number().int().min(0).max(100).optional(),
});
const internalOrderBody = z.strictObject({
  conversation_ref: z.uuid(),
  customer,
  items: z.array(cartItem).min(1).max(20),
  delivery,
  // The discount the customer negotiated, as sent to cart-quotes. Core caps it again at the vendor's limit, then
  // expected_total must equal the re-priced total: the model never sets a price.
  discount_pct: z.number().int().min(0).max(100).optional(),
  expected_total: moneySchema,
});

const idemKey = (req: FastifyRequest) => req.headers['idempotency-key'] as string | undefined;

// Cart quotes, orders and the checkout / order page (architecture.md sections 5.2 A, 5.3.1, 6.2).
export const ordersModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  // ----------------------------------------------------------------------------------- public

  app.post<{ Params: { slug: string } }>('/api/v1/stores/:slug/cart-quotes', async (req) => {
    const body = cartQuoteBody.parse(req.body);
    const vendor = await findVendorBySlug(ctx(), req.params.slug);
    const q = await quoteCart(ctx(), vendor, body);
    const { totalSat, quote } = await satsFor(ctx(), q.currency, q.total);
    return {
      lines: q.lines.map((l) => lineMoney(q, l)),
      subtotal: money(q.subtotal, q.currency),
      delivery_fee: money(q.deliveryFee, q.currency),
      discount: money(q.discount, q.currency),
      total: money(q.total, q.currency),
      total_sat: totalSat,
      rate: quote
        ? {
            xof_per_btc: Math.floor(quote.xofPerBtcCents / 100),
            source: quote.source,
            quoted_at: iso(quote.fetchedAt),
          }
        : null,
    };
  });

  app.post('/api/v1/orders', async (req, reply) => {
    const body = orderBody.parse(req.body);
    const vendor = await findVendorBySlug(ctx(), body.store_slug);
    const res = await withIdempotency(ctx(), `ip:${req.ip}`, idemKey(req), body, async () => ({
      status: 201,
      body: await createOrder(ctx(), {
        vendor,
        channel: body.channel,
        customer: body.customer,
        items: body.items,
        delivery: body.delivery,
        expectedTotal: body.expected_total,
        actor: 'customer:web',
      }),
    }));
    return reply.code(res.status).send(res.body);
  });

  app.get<{ Params: { token: string } }>('/api/v1/checkout/:token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex');
    return checkoutView(ctx(), req.params.token);
  });

  app.get<{ Params: { token: string } }>('/api/v1/checkout/:token/status', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return checkoutStatus(ctx(), req.params.token);
  });

  app.post<{ Params: { token: string } }>('/api/v1/checkout/:token/invoice', async (req, reply) => {
    const order = await findOrderByToken(ctx(), req.params.token);
    const res = await withIdempotency(ctx(), `order:${order.id}`, idemKey(req), {}, async () => ({
      status: 201,
      body: await renewInvoice(ctx(), req.params.token),
    }));
    return reply.code(res.status).send(res.body);
  });

  // Server-Sent Events. A signal (LISTEN/NOTIFY) on every order event makes it look at once; the slow poll
  // (SSE_POLL_MS) covers a lost LISTEN connection and invoice expiry, which has no event.
  app.get<{ Params: { token: string } }>('/api/v1/checkout/:token/events', async (req, reply) => {
    const order = await findOrderByToken(ctx(), req.params.token);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let id = Number(req.headers['last-event-id'] ?? 0) || 0;
    let lastSent = '';
    let lastWrite = Date.now();
    let closed = false;
    let busy = false;
    let again = false;
    const stop = () => {
      closed = true;
      clearInterval(timer);
      off();
      if (!res.writableEnded) res.end();
    };
    const tick = async (): Promise<void> => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        const s = await checkoutStatus(ctx(), req.params.token);
        const data = JSON.stringify({
          status: s.status,
          invoice: { status: s.invoice_status, expires_at: s.expires_at },
          paid_at: s.paid_at,
          fulfilled_at: s.fulfilled_at,
        });
        if (data !== lastSent) {
          lastSent = data;
          res.write(`event: status\nid: ${++id}\ndata: ${data}\n\n`);
          lastWrite = Date.now();
          if (s.status === 'cancelled' || s.status === 'fulfilled') stop();
        } else if (Date.now() - lastWrite >= 20_000) {
          res.write(': ping\n\n'); // keeps mobile networks and proxies from closing the stream
          lastWrite = Date.now();
        }
      } catch {
        stop();
      } finally {
        busy = false;
      }
      if (again) {
        again = false;
        return tick();
      }
    };
    const timer = setInterval(tick, ctx().config.SSE_POLL_MS);
    const off = ctx().signals.on('order', order.id, () => void tick());
    req.raw.on('close', stop);
    await tick();
  });

  // ----------------------------------------------------------------------------------- internal (agent)

  app.post<{ Params: { id: string } }>('/internal/v1/vendors/:id/cart-quotes', async (req) => {
    const body = internalQuoteBody.parse(req.body);
    const vendor = await findVendorById(ctx(), req.params.id);
    const q = await quoteCart(ctx(), vendor, body, { discountPct: body.discount_pct ?? 0 });
    return {
      lines: q.lines.map((l) => lineMoney(q, l)),
      subtotal: money(q.subtotal, q.currency),
      delivery_fee: money(q.deliveryFee, q.currency),
      discount: money(q.discount, q.currency),
      total: money(q.total, q.currency),
      max_discount_pct: q.maxDiscountPct,
      applied_discount_pct: q.appliedDiscountPct,
    };
  });

  app.post<{ Params: { id: string } }>('/internal/v1/vendors/:id/orders', async (req, reply) => {
    const body = internalOrderBody.parse(req.body);
    const vendor = await findVendorById(ctx(), req.params.id);
    const res = await withIdempotency(
      ctx(),
      'svc:agent',
      idemKey(req),
      { vendor: vendor.id, ...body },
      async () => {
        const created = await createOrder(ctx(), {
          vendor,
          channel: 'web',
          conversationRef: body.conversation_ref,
          customer: body.customer,
          items: body.items,
          delivery: body.delivery,
          expectedTotal: body.expected_total,
          discountPct: body.discount_pct ?? 0,
          actor: `customer:${body.conversation_ref}`,
        });
        return {
          status: 201,
          body: {
            number: created.order.number,
            checkout_url: created.checkout_url,
            total: created.order.total,
            total_sat: created.order.total_sat,
            expires_at: created.order.expires_at,
          },
        };
      },
    );
    return reply.code(res.status).send(res.body);
  });

  app.get<{ Params: { id: string } }>('/internal/v1/vendors/:id/orders', async (req) => {
    const q = z
      .object({
        status: z.enum(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired']).optional(),
        period: z.enum(['today', '7d']).optional(),
      })
      .parse(req.query);
    return listOrders(ctx(), await findVendorById(ctx(), req.params.id), q);
  });

  app.get<{ Params: { id: string; order_ref: string } }>(
    '/internal/v1/vendors/:id/orders/:order_ref',
    async (req) => {
      const vendor = await findVendorById(ctx(), req.params.id);
      return statusView(await findOrder(ctx(), vendor, req.params.order_ref));
    },
  );

  app.post<{ Params: { id: string; order_ref: string } }>(
    '/internal/v1/vendors/:id/orders/:order_ref/fulfill',
    async (req) => {
      const { note } = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
      const vendor = await findVendorById(ctx(), req.params.id);
      return fulfillOrder(
        ctx(),
        vendor,
        req.params.order_ref,
        actorOf(req.headers['x-actor'], vendor.id),
        note,
      );
    },
  );

  app.get<{ Params: { id: string } }>('/internal/v1/vendors/:id/metrics', async (req) => {
    const { period } = z
      .object({ period: z.enum(['today', '7d', '30d']).default('today') })
      .parse(req.query);
    return metrics(ctx(), await findVendorById(ctx(), req.params.id), period);
  });

  // ----------------------------------------------------------------------------------- the vendor's dashboard

  app.get('/api/v1/orders', async (req) => {
    const s = await requireVendor(ctx(), req);
    const q = z
      .object({
        status: z.enum(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired']).optional(),
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    return listVendorOrders(ctx(), await findVendorById(ctx(), s.vendorId), q);
  });

  app.get<{ Params: { id: string } }>('/api/v1/orders/:id', async (req) => {
    const s = await requireVendor(ctx(), req);
    const vendor = await findVendorById(ctx(), s.vendorId);
    return vendorOrderView(ctx(), await findVendorOrderById(ctx(), vendor, req.params.id));
  });

  app.patch<{ Params: { id: string } }>('/api/v1/orders/:id/fulfill', async (req) => {
    const s = await requireVendor(ctx(), req);
    const { note } = z.strictObject({ note: z.string().max(300).optional() }).parse(req.body ?? {});
    return fulfillVendorOrder(ctx(), await findVendorById(ctx(), s.vendorId), req.params.id, note);
  });

  app.post<{ Params: { id: string } }>('/api/v1/orders/:id/cancel', async (req) => {
    const s = await requireVendor(ctx(), req);
    const { reason } = z
      .strictObject({ reason: z.string().trim().min(2).max(300) })
      .parse(req.body);
    return cancelVendorOrder(ctx(), await findVendorById(ctx(), s.vendorId), req.params.id, reason);
  });

  app.get('/api/v1/vendors/dashboard/metrics', async (req) => {
    const s = await requireVendor(ctx(), req);
    const { period } = z
      .object({ period: z.enum(['today', '7d', '30d', 'year']).default('today') })
      .parse(req.query);
    return dashboardMetrics(ctx(), await findVendorById(ctx(), s.vendorId), period);
  });
};
