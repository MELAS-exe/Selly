// Cart quotes, order creation and the customer's view of an order (architecture.md sections 4.5, 4.6, 5.3.1, 6.2).
import { core } from '@selly/db';
import { satToMsat, xofToSat } from '@selly/money';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso, money, orderNumber, publicToken } from '../../util';
import { storeStatus, type Vendor, vendorSettings } from '../catalog/store';
import { audit, publishEvent } from '../events/outbox';
import * as inventory from '../inventory/service';
import { orderEventData } from '../payments/service';

const { orders, orderItems, invoices, customers, productVariants: pv, products, rateQuotes } = core;

const INVOICE_EXPIRY_SECONDS = 20 * 60;
const GRACE_MS = 2 * 60_000;
const MAX_PENDING_PER_CUSTOMER = 3;
const MAX_UNITS_PER_VARIANT = 5;

type Cur = 'XOF' | 'SAT';
export interface CartItemInput {
  variant_id: string;
  quantity: number;
}
export interface DeliveryInput {
  method: 'delivery' | 'pickup';
  zone_id?: string | undefined;
  address_text?: string | undefined;
  note?: string | undefined;
}

export interface QuoteLine {
  variantId: string;
  productId: string;
  title: string;
  options: Record<string, string>;
  quantity: number;
  unitPrice: number;
}
export interface Quote {
  currency: Cur;
  lines: QuoteLine[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  maxDiscountPct: number;
  appliedDiscountPct: number;
}

/** Totals for a cart. Pure data from the database: the model and the browser never compute a total. */
export async function quoteCart(
  ctx: Context,
  vendor: Vendor,
  input: { items: CartItemInput[]; delivery: DeliveryInput },
  opts: { discountPct?: number } = {},
): Promise<Quote> {
  const settings = vendorSettings(vendor);
  if ((await storeStatus(ctx, vendor)) !== 'active') {
    throw new AppError('STORE_PAUSED', 'This shop is temporarily closed.');
  }

  // The same variant twice is one line.
  const wanted = new Map<string, number>();
  for (const i of input.items)
    wanted.set(i.variant_id, (wanted.get(i.variant_id) ?? 0) + i.quantity);

  const rows = await ctx.db
    .select({ v: pv, p: products })
    .from(pv)
    .innerJoin(products, eq(products.id, pv.productId))
    .where(
      and(
        inArray(pv.id, [...wanted.keys()]),
        eq(products.vendorId, vendor.id),
        eq(products.status, 'active'),
      ),
    );

  const unknown = [...wanted.keys()].filter((id) => !rows.some((r) => r.v.id === id));
  if (unknown.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'Some items are not sold by this shop.', {
      errors: unknown.map((id) => ({
        field: 'items.variant_id',
        message: `Unknown variant ${id}`,
      })),
    });
  }

  const short: Record<string, unknown>[] = [];
  const lines: QuoteLine[] = rows.map(({ v, p }) => {
    const quantity = wanted.get(v.id) as number;
    if (p.priceCurrency !== settings.pricingCurrency) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A product is priced in a different currency than the shop.',
      );
    }
    if (quantity > MAX_UNITS_PER_VARIANT) {
      throw new AppError(
        'VALIDATION_FAILED',
        `At most ${MAX_UNITS_PER_VARIANT} units of one item per order.`,
        {
          errors: [{ field: 'items.quantity', message: `Max ${MAX_UNITS_PER_VARIANT}` }],
        },
      );
    }
    if (v.onHand - v.reserved < quantity)
      short.push({ variant_id: v.id, available: Math.max(v.onHand - v.reserved, 0) });
    return {
      variantId: v.id,
      productId: p.id,
      title: p.title,
      options: v.options,
      quantity,
      unitPrice: v.priceOverride ?? p.priceAmount,
    };
  });
  if (short.length > 0)
    throw new AppError('OUT_OF_STOCK', 'Some items are no longer available.', { errors: short });

  let deliveryFee = 0;
  if (input.delivery.method === 'delivery') {
    const zone = settings.delivery.zones.find((z) => z.id === input.delivery.zone_id);
    if (!zone) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown delivery zone "${input.delivery.zone_id ?? ''}".`,
        {
          errors: [{ field: 'delivery.zone_id', message: 'Unknown zone' }],
        },
      );
    }
    deliveryFee = zone.fee.amount;
  } else if (!settings.delivery.pickup.available) {
    throw new AppError('VALIDATION_FAILED', 'This shop does not offer pickup.', {
      errors: [{ field: 'delivery.method', message: 'Pickup not available' }],
    });
  }

  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const maxDiscountPct =
    settings.negotiation.mode === 'allow' ? settings.negotiation.maxDiscountPct : 0;
  const appliedDiscountPct = Math.min(opts.discountPct ?? 0, maxDiscountPct);
  const discount = Math.floor((subtotal * appliedDiscountPct) / 100);
  return {
    currency: settings.pricingCurrency,
    lines,
    subtotal,
    deliveryFee,
    discount,
    total: subtotal + deliveryFee - discount,
    maxDiscountPct,
    appliedDiscountPct,
  };
}

/** Sats for a total. XOF shops convert at a stored rate quote; SAT shops charge the price as it is. */
export async function satsFor(ctx: Context, currency: Cur, total: number) {
  if (currency === 'SAT') return { totalSat: total, quote: null };
  const quote = await ctx.rates.current();
  return { totalSat: Number(xofToSat(BigInt(total), BigInt(quote.xofPerBtcCents))), quote };
}

export const lineMoney = (q: Quote, l: QuoteLine) => ({
  variant_id: l.variantId,
  title: l.title,
  options: l.options,
  quantity: l.quantity,
  unit_price: money(l.unitPrice, q.currency),
  line_total: money(l.unitPrice * l.quantity, q.currency),
});

export interface CreateOrderInput {
  vendor: Vendor;
  channel: 'web' | 'whatsapp' | 'instagram';
  conversationRef?: string | undefined;
  customer: { display_name: string; phone_e164: string };
  items: CartItemInput[];
  delivery: DeliveryInput;
  expectedTotal: { amount: number; currency: Cur };
  discountPct?: number;
  actor: string;
}

export async function createOrder(ctx: Context, input: CreateOrderInput) {
  const { vendor } = input;
  const now = ctx.now();
  const quote = await quoteCart(ctx, vendor, input, { discountPct: input.discountPct ?? 0 });

  if (
    input.expectedTotal.amount !== quote.total ||
    input.expectedTotal.currency !== quote.currency
  ) {
    throw new AppError(
      'PRICE_CHANGED',
      `The total is now ${quote.total} ${quote.currency}, not ${input.expectedTotal.amount}.`,
      {
        errors: [{ expected: input.expectedTotal, actual: money(quote.total, quote.currency) }],
      },
    );
  }

  // Abuse limit: unpaid orders per customer.
  const [existing] = await ctx.db
    .select()
    .from(customers)
    .where(
      and(eq(customers.vendorId, vendor.id), eq(customers.phoneE164, input.customer.phone_e164)),
    );
  if (existing) {
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.customerId, existing.id), eq(orders.status, 'pending_payment')));
    if (n >= MAX_PENDING_PER_CUSTOMER) {
      throw new AppError(
        'TOO_MANY_PENDING_ORDERS',
        `You already have ${n} unpaid orders with this shop.`,
      );
    }
  }

  // Short code that is free for this vendor. A lost race hits the unique constraint and the client retries.
  let number = orderNumber();
  for (let i = 0; i < 5; i++) {
    const [taken] = await ctx.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.vendorId, vendor.id), eq(orders.number, number)));
    if (!taken) break;
    number = orderNumber();
  }

  const { totalSat, quote: rate } = await satsFor(ctx, quote.currency, quote.total);
  const amountMsat = Number(satToMsat(BigInt(totalSat)));

  // The wallet is called outside any transaction: stock is never held while waiting on the network.
  const invoice = await makeInvoiceFor(ctx, vendor, number, amountMsat);

  return ctx.db
    .transaction(async (tx) => {
      let customerId = existing?.id;
      if (!customerId) {
        const [c] = await tx
          .insert(customers)
          .values({
            vendorId: vendor.id,
            displayName: input.customer.display_name,
            phoneE164: input.customer.phone_e164,
          })
          .returning({ id: customers.id });
        customerId = (c as { id: string }).id;
      }

      const token = publicToken();
      const [order] = await tx
        .insert(orders)
        .values({
          vendorId: vendor.id,
          customerId,
          number,
          publicToken: token,
          channel: input.channel,
          conversationRef: input.conversationRef ?? null,
          pricingCurrency: quote.currency,
          subtotalXof: quote.subtotal,
          deliveryFeeXof: quote.deliveryFee,
          discountXof: quote.discount,
          totalXof: quote.total,
          totalMsat: amountMsat,
          rateQuoteId: rate?.id ?? null,
          delivery: { ...input.delivery, contact_phone: input.customer.phone_e164 },
          expiresAt: new Date(invoice.expiresAt.getTime() + GRACE_MS),
        })
        .returning();
      const o = order as typeof orders.$inferSelect;

      await tx.insert(orderItems).values(
        quote.lines.map((l) => ({
          orderId: o.id,
          variantId: l.variantId,
          quantity: l.quantity,
          unitPriceAmount: l.unitPrice,
          priceCurrency: quote.currency,
          titleSnapshot: l.title,
          optionsSnapshot: l.options,
        })),
      );
      await inventory.reserve(
        tx,
        o.id,
        quote.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        input.actor,
      );
      await tx.insert(invoices).values({
        orderId: o.id,
        vendorId: vendor.id,
        walletConnectionId: invoice.walletConnectionId,
        source: invoice.source,
        bolt11: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        amountMsat: invoice.amountMsat,
        description: `${vendor.displayName} commande ${number}`,
        verifyUrl: invoice.verifyUrl ?? null,
        expiresAt: invoice.expiresAt,
      });
      await publishEvent(tx, {
        type: 'order.created',
        vendorId: vendor.id,
        key: o.id,
        data: orderEventData(ctx.config.APP_BASE_URL, o),
        now,
      });
      await audit(tx, { actor: input.actor, action: 'order.created', target: o.id });
      return o;
    })
    .then((o) => orderCreatedView(ctx, o.id));
}

async function makeInvoiceFor(ctx: Context, vendor: Vendor, number: string, amountMsat: number) {
  let made: Awaited<ReturnType<ReturnType<Context['invoices']['forVendor']>['makeInvoice']>>;
  try {
    made = await ctx.invoices.forVendor(vendor.id).makeInvoice({
      vendorId: vendor.id,
      amountMsat,
      description: `${vendor.displayName} commande ${number}`,
      expirySeconds: INVOICE_EXPIRY_SECONDS,
    });
  } catch (err) {
    ctx.log.warn({ err: String(err), vendorId: vendor.id }, 'make_invoice failed');
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      "The vendor's wallet did not answer. No order was created and no stock is held.",
      {
        headers: { 'Retry-After': '30' },
      },
    );
  }
  // A wrong answer from a wallet must never become an order (architecture.md section 3.6).
  if (
    made.amountMsat !== amountMsat ||
    made.expiresAt <= ctx.now() ||
    !/^[0-9a-f]{64}$/.test(made.paymentHash)
  ) {
    throw new AppError(
      'PAYMENT_UNAVAILABLE',
      'The wallet returned an invoice that does not match the request.',
      {
        headers: { 'Retry-After': '30' },
      },
    );
  }
  return made;
}

// ---------------------------------------------------------------------------------------------- views

type OrderRow = typeof orders.$inferSelect;

async function orderView(ctx: Context, o: OrderRow) {
  const items = await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  const [rate] = o.rateQuoteId
    ? await ctx.db.select().from(rateQuotes).where(eq(rateQuotes.id, o.rateQuoteId))
    : [];
  const cur = o.pricingCurrency;
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    public_token: o.publicToken,
    items: items.map((i) => ({
      title: i.titleSnapshot,
      options: i.optionsSnapshot,
      quantity: i.quantity,
      unit_price: money(i.unitPriceAmount, i.priceCurrency),
    })),
    subtotal: money(o.subtotalXof, cur),
    delivery_fee: money(o.deliveryFeeXof, cur),
    discount: money(o.discountXof, cur),
    total: money(o.totalXof, cur),
    total_sat: o.totalMsat / 1000,
    rate: rate
      ? {
          xof_per_btc: Math.floor(rate.xofPerBtcCents / 100),
          source: rate.source,
          quoted_at: iso(rate.fetchedAt),
        }
      : null,
    expires_at: iso(o.expiresAt),
    paid_at: iso(o.paidAt),
    fulfilled_at: iso(o.fulfilledAt),
  };
}

function invoiceView(inv: typeof invoices.$inferSelect) {
  return {
    bolt11: inv.bolt11,
    payment_hash: inv.paymentHash,
    amount_msat: inv.amountMsat,
    status: inv.status,
    expires_at: iso(inv.expiresAt),
    lightning_uri: `lightning:${inv.bolt11}`,
  };
}

/** The invoice a customer should see: the newest one that is still payable, else the newest. */
async function currentInvoice(ctx: Context, orderId: string) {
  const all = await ctx.db
    .select()
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(desc(invoices.createdAt));
  return (
    all.find((i) => i.status === 'settled') ??
    all.find((i) => i.status === 'pending') ??
    all[0] ??
    null
  );
}

async function orderCreatedView(ctx: Context, orderId: string) {
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
  const order = o as OrderRow;
  const inv = (await currentInvoice(ctx, orderId)) as typeof invoices.$inferSelect;
  return {
    order: await orderView(ctx, order),
    invoice: invoiceView(inv),
    checkout_url: `${ctx.config.APP_BASE_URL}/c/${order.publicToken}`,
    payment_options: ['lightning'] as const,
  };
}

export async function findOrderByToken(ctx: Context, token: string): Promise<OrderRow> {
  const [o] = await ctx.db.select().from(orders).where(eq(orders.publicToken, token));
  if (!o) throw new AppError('NOT_FOUND', 'This order link is not valid or has expired.');
  return o;
}

export async function checkoutView(ctx: Context, token: string) {
  const o = await findOrderByToken(ctx, token);
  const [vendor] = await ctx.db.select().from(core.vendors).where(eq(core.vendors.id, o.vendorId));
  const v = vendor as Vendor;
  const inv = await currentInvoice(ctx, o.id);
  const payable = inv && inv.status === 'pending';
  return {
    order: await orderView(ctx, o),
    invoice: inv
      ? {
          ...invoiceView(inv),
          ...(payable
            ? {
                qr_svg: await QRCode.toString(inv.bolt11.toUpperCase(), { type: 'svg', margin: 1 }),
              }
            : {}),
        }
      : null,
    store: {
      slug: v.slug,
      display_name: v.displayName,
      whatsapp_link: v.contactWhatsappE164
        ? `https://wa.me/${v.contactWhatsappE164.replace('+', '')}`
        : null,
    },
    payment_options: ['lightning'] as const,
    help_url: `${ctx.config.APP_BASE_URL}/aide/payer-en-bitcoin`,
  };
}

export async function checkoutStatus(ctx: Context, token: string) {
  const o = await findOrderByToken(ctx, token);
  const inv = await currentInvoice(ctx, o.id);
  return {
    status: o.status,
    invoice_status: inv?.status ?? null,
    expires_at: iso(o.expiresAt),
    paid_at: iso(o.paidAt),
    fulfilled_at: iso(o.fulfilledAt),
  };
}

/** New invoice for an order that is waiting or expired: fresh rate, stock reserved again (architecture.md 4.4). */
export async function renewInvoice(ctx: Context, token: string) {
  const order = await findOrderByToken(ctx, token);
  if (order.status !== 'pending_payment' && order.status !== 'expired') {
    throw new AppError('VALIDATION_FAILED', `The order is already ${order.status}.`);
  }
  const [vendor] = await ctx.db
    .select()
    .from(core.vendors)
    .where(eq(core.vendors.id, order.vendorId));
  const v = vendor as Vendor;
  if ((await storeStatus(ctx, v)) !== 'active')
    throw new AppError('STORE_PAUSED', 'This shop is temporarily closed.');

  const { totalSat, quote: rate } = await satsFor(ctx, order.pricingCurrency, order.totalXof);
  const amountMsat = Number(satToMsat(BigInt(totalSat)));
  const invoice = await makeInvoiceFor(ctx, v, order.number, amountMsat);
  const now = ctx.now();

  await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for('update');
    const o = locked as OrderRow;
    if (o.status === 'expired') {
      const items = await tx
        .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, o.id));
      await inventory.reserve(tx, o.id, items, 'system');
    } else if (o.status !== 'pending_payment') {
      throw new AppError('VALIDATION_FAILED', `The order is already ${o.status}.`);
    }
    await tx
      .update(invoices)
      .set({ status: 'cancelled' })
      .where(and(eq(invoices.orderId, o.id), eq(invoices.status, 'pending')));
    await tx.insert(invoices).values({
      orderId: o.id,
      vendorId: o.vendorId,
      walletConnectionId: invoice.walletConnectionId,
      source: invoice.source,
      bolt11: invoice.bolt11,
      paymentHash: invoice.paymentHash,
      amountMsat: invoice.amountMsat,
      description: `${v.displayName} commande ${o.number}`,
      verifyUrl: invoice.verifyUrl ?? null,
      expiresAt: invoice.expiresAt,
    });
    await tx
      .update(orders)
      .set({
        status: 'pending_payment',
        totalMsat: amountMsat,
        rateQuoteId: rate?.id ?? null,
        expiresAt: new Date(invoice.expiresAt.getTime() + GRACE_MS),
        updatedAt: now,
      })
      .where(eq(orders.id, o.id));
  });
  return orderCreatedView(ctx, order.id);
}
