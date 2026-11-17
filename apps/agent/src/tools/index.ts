// Agent tools (architecture.md section 8.3). The vendor id is never a tool parameter: it comes from
// the conversation, fixed server-side (section 8.1). The tool list is chosen by role before the model
// is called, so a customer conversation never sees vendor tools (section 8.4).

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CallContext, CoreClient } from '../core/client';
import type { AgentProfile, Card, CartQuote, Money, QuickReply } from '../core/types';
import type { LlmToolDef } from '../engine/llm';
import { CoreError } from '../errors';
import { UUID_RE } from '../ids';
import type { Conversation, ConversationState } from '../store/types';
import type { ProductExtractor } from '../vision';
import { lowConfidenceFields, toDraftExtracted } from '../vision';

export interface HandoffRequest {
  reason:
    | 'customer_request'
    | 'negotiation'
    | 'complaint'
    | 'unsure'
    | 'other'
    | 'payment_unavailable';
  summary: string;
}

/** Everything a tool may touch, set by the server for this turn. */
export interface ToolContext {
  core: CoreClient;
  conversation: Conversation;
  profile: AgentProfile;
  call: CallContext;
  /** Mutable copy of the conversation state; saved after the turn. */
  state: ConversationState;
  /** Image keys attached to the vendor's message in this turn (the only ones a draft may use). */
  imageKeys: string[];
  extractor: ProductExtractor;
  /** Pauses or resumes the bot for this chat or all chats (vendor assistant). */
  setBotMode(
    scope: 'all' | 'conversation',
    mode: 'bot' | 'paused',
    minutes?: number,
  ): Promise<void>;
  reportDraftUsage(reference: string): Promise<void>;
  out: {
    cards: Card[];
    quickReplies: QuickReply[];
    handoff?: HandoffRequest;
    /** Amounts seen in tool results this turn: a price in the reply must be one of them (P5). */
    amounts: Set<number>;
  };
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<unknown>;
}

const tool = <S extends z.ZodType>(spec: ToolSpec<S>) => spec as unknown as ToolSpec<z.ZodType>;

const money = z.strictObject({ amount: z.number().int().min(0), currency: z.enum(['XOF', 'SAT']) });
const items = z
  .array(
    z.strictObject({
      variant_id: z.uuid().describe('variant_id from search_products or get_product'),
      quantity: z.number().int().min(1).max(5),
    }),
  )
  .min(1)
  .max(10);
const orderNumber = z
  .string()
  .regex(/^[A-Za-z0-9]{3,12}$/)
  .describe('numéro court, par exemple A7K2');
const delivery = z.strictObject({
  method: z.enum(['delivery', 'pickup']),
  zone_id: z
    .string()
    .optional()
    .describe('id of a delivery zone from the shop profile, required for delivery'),
  address_text: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});

function rememberAmounts(ctx: ToolContext, ...values: (Money | null | undefined)[]) {
  for (const v of values) if (v) ctx.out.amounts.add(v.amount);
}

function addCard(ctx: ToolContext, card: Card) {
  const key = card.type === 'product' ? card.product_id : card.number;
  ctx.out.cards = ctx.out.cards.filter(
    (c) => (c.type === 'product' ? c.product_id : c.number) !== key,
  );
  ctx.out.cards.push(card);
  if (ctx.out.cards.length > 3) ctx.out.cards.shift();
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- sales agent

const searchProducts = tool({
  name: 'search_products',
  description:
    "Cherche dans le catalogue de la boutique. Renvoie jusqu'à 5 produits avec prix, lien et stock disponible par variante. Utilise-le pour toute question de prix, de disponibilité, de taille ou de couleur.",
  input: z.strictObject({
    query: z.string().min(1).describe('mots du client, par exemple "robe noire"'),
    size: z.string().optional().describe('taille ou pointure normalisée, par exemple "42"'),
    color: z.string().optional().describe('couleur en français, par exemple "noir"'),
    max_price_xof: z.number().int().optional(),
    limit: z.number().int().min(1).max(5).optional(),
  }),
  async run(p, ctx) {
    const res = await ctx.core.searchProducts(
      ctx.conversation.vendorId,
      {
        q: p.query,
        size: p.size,
        color: p.color,
        max_price_xof: p.max_price_xof,
        limit: p.limit ?? 5,
      },
      ctx.call,
    );
    for (const r of res.results.slice(0, 3)) {
      rememberAmounts(ctx, r.price);
      addCard(ctx, {
        type: 'product',
        product_id: r.product_id,
        title: r.title,
        price: r.price,
        image_url: r.image_url,
        url: r.url,
      });
    }
    // Keep only the most relevant cards: the ones the reply is about are added last.
    return res;
  },
});

const getProduct = tool({
  name: 'get_product',
  description: 'Détail d’un produit : description, options, variantes et stock disponible.',
  input: z.strictObject({ product_id: z.uuid() }),
  async run(p, ctx) {
    const d = await ctx.core.getProduct(ctx.conversation.vendorId, p.product_id, ctx.call);
    rememberAmounts(ctx, d.price, ...d.variants.map((v) => v.price));
    ctx.state.productInView = d.id;
    addCard(ctx, {
      type: 'product',
      product_id: d.id,
      title: d.title,
      price: d.price,
      image_url: d.images[0]?.url ?? null,
      url: d.url,
    });
    return d;
  },
});

const quoteCart = tool({
  name: 'quote_cart',
  description:
    'Calcule le total exact (articles, livraison, remise) côté boutique. Obligatoire avant create_order. Ne calcule jamais un total toi-même. discount_pct est la remise demandée ; la boutique la plafonne à max_discount_pct.',
  input: z.strictObject({
    items,
    delivery,
    discount_pct: z.number().int().min(0).max(100).optional(),
  }),
  async run(p, ctx) {
    const quote = await ctx.core.createCartQuote(ctx.conversation.vendorId, p, ctx.call);
    rememberQuote(ctx, p, quote);
    return quote;
  },
});

function rememberQuote(
  ctx: ToolContext,
  req: {
    items: { variant_id: string; quantity: number }[];
    delivery: unknown;
    discount_pct?: number;
  },
  quote: CartQuote,
) {
  rememberAmounts(
    ctx,
    quote.subtotal,
    quote.delivery_fee,
    quote.discount,
    quote.total,
    ...quote.lines.flatMap((l) => [l.unit_price, l.line_total]),
  );
  ctx.state.cart = req.items;
  ctx.state.lastQuote = {
    items: req.items,
    delivery: req.delivery,
    total: quote.total,
    ...(req.discount_pct ? { discountPct: req.discount_pct } : {}),
  };
  ctx.state.lastQuoteTotal = quote.total;
}

const createOrder = tool({
  name: 'create_order',
  description:
    'Crée la commande et le lien de paiement Lightning. Seulement après un « oui » explicite du client au total annoncé par quote_cart, avec les mêmes articles et la même livraison. Il faut le nom et le numéro de téléphone du client (format +221...).',
  input: z.strictObject({
    items,
    delivery,
    customer: z.strictObject({
      display_name: z.string().min(2).max(60),
      phone_e164: z
        .string()
        .regex(/^\+[1-9][0-9]{7,14}$/)
        .describe('numéro au format international, par exemple +221771234567'),
    }),
  }),
  async run(p, ctx) {
    const q = ctx.state.lastQuote;
    if (!q || !sameJson(q.items, p.items) || !sameJson(q.delivery, p.delivery)) {
      return {
        error: 'QUOTE_REQUIRED',
        hint: 'Appelle quote_cart avec ces articles et cette livraison, annonce le total au client et attends son accord.',
      };
    }
    // Same quote and customer give the same key, so a retry never creates a second order.
    const idempotencyKey = createHash('sha256')
      .update(JSON.stringify([ctx.conversation.id, q, p.customer]))
      .digest('hex')
      .slice(0, 40);
    const order = await ctx.core.createOrder(
      ctx.conversation.vendorId,
      {
        conversation_ref: ctx.conversation.id,
        customer: p.customer,
        items: p.items,
        delivery: p.delivery,
        // Core caps the discount again and requires expected_total to equal its own total.
        ...(q.discountPct ? { discount_pct: q.discountPct } : {}),
        expected_total: q.total,
      },
      idempotencyKey,
      ctx.call,
    );
    rememberAmounts(ctx, order.total);
    ctx.out.amounts.add(order.total_sat);
    ctx.state.lastOrderNumber = order.number;
    ctx.state.orders = { ...(ctx.state.orders ?? {}), [order.number]: order.checkout_url };
    ctx.state.customer = p.customer;
    ctx.state.cart = undefined;
    ctx.state.lastQuote = undefined;
    ctx.out.cards = ctx.out.cards.filter((c) => c.type !== 'product');
    addCard(ctx, {
      type: 'order',
      number: order.number,
      status: 'pending_payment',
      total: order.total,
      total_sat: order.total_sat,
      checkout_url: order.checkout_url,
      expires_at: order.expires_at,
    });
    return order;
  },
});

const getOrderStatus = tool({
  name: 'get_order_status',
  description: 'Statut d’une commande par son numéro court (par exemple A7K2).',
  input: z.strictObject({ number: orderNumber }),
  async run(p, ctx) {
    // A customer only sees the orders created in this conversation, never the shop's other orders.
    const number = p.number.toUpperCase();
    if (!ctx.state.orders?.[number])
      return { error: 'NOT_FOUND', hint: 'Aucune commande de ce numéro dans cette discussion.' };
    const o = await ctx.core.getOrder(ctx.conversation.vendorId, number, ctx.call);
    rememberAmounts(ctx, o.total);
    return o;
  },
});

const getShopInfo = tool({
  name: 'get_shop_info',
  description:
    'Informations de la boutique : livraison (zones et frais), horaires, adresse de retrait, retours, paiement.',
  input: z.strictObject({ topic: z.enum(['delivery', 'hours', 'location', 'returns', 'payment']) }),
  async run(p, ctx) {
    const pr = ctx.profile;
    switch (p.topic) {
      case 'delivery':
        rememberAmounts(ctx, ...pr.delivery.zones.map((z) => z.fee));
        return { zones: pr.delivery.zones, pickup: pr.delivery.pickup };
      case 'hours':
        return { hours: pr.hours };
      case 'location':
        return { pickup: pr.delivery.pickup, store_url: pr.store_url };
      case 'returns':
        return { returns: pr.policies.returns };
      case 'payment':
        return {
          payment: pr.policies.payment,
          help: 'Le client paie une facture Lightning en bitcoin. Sans bitcoin, la page /aide/payer-en-bitcoin explique comment en acheter avec Orange Money ou Wave.',
        };
    }
  },
});

const handoff = tool({
  name: 'handoff_to_vendor',
  description:
    'Passe la main au vendeur : le client demande une personne, une négociation dépasse la limite, une réclamation, un problème de commande, ou tu ne comprends pas après deux essais.',
  input: z.strictObject({
    reason: z.enum(['customer_request', 'negotiation', 'complaint', 'unsure', 'other']),
    summary: z.string().min(3).max(500).describe('résumé pour le vendeur, en français'),
  }),
  async run(p, ctx) {
    ctx.out.handoff = p;
    return {
      ok: true,
      note: 'Le vendeur est prévenu. Dis au client qu’il va lui répondre ici même.',
    };
  },
});

// ---------------------------------------------------------------- vendor assistant

async function resolveProduct(ctx: ToolContext, ref: string) {
  if (UUID_RE.test(ref)) return ctx.core.getProduct(ctx.conversation.vendorId, ref, ctx.call);
  const res = await ctx.core.searchProducts(
    ctx.conversation.vendorId,
    { q: ref, limit: 5 },
    ctx.call,
  );
  if (res.results.length === 0)
    return { error: 'NOT_FOUND', hint: `Aucun produit ne correspond à « ${ref} ».` } as const;
  if (res.results.length > 1) {
    const exact = res.results.find((r) => r.title.toLowerCase() === ref.toLowerCase());
    if (!exact)
      return {
        error: 'AMBIGUOUS',
        candidates: res.results.map((r) => ({ product_id: r.product_id, title: r.title })),
        hint: 'Demande au vendeur lequel, ou rappelle l’outil avec le product_id.',
      } as const;
    return ctx.core.getProduct(ctx.conversation.vendorId, exact.product_id, ctx.call);
  }
  return ctx.core.getProduct(
    ctx.conversation.vendorId,
    (res.results[0] as { product_id: string }).product_id,
    ctx.call,
  );
}

const createProductDraft = tool({
  name: 'create_product_draft',
  description:
    "Crée un brouillon de produit à partir des photos jointes au message du vendeur et de son texte (« Ajoute ces baskets à 20 000, 5 paires du 40 au 44 »). Rien n'est publié avant confirmation.",
  input: z.strictObject({ text: z.string().max(1000).optional() }),
  async run(p, ctx) {
    const extraction = await ctx.extractor.extract({
      imageKeys: ctx.imageKeys,
      text: p.text,
      vendorId: ctx.conversation.vendorId,
      conversationId: ctx.conversation.id,
    });
    const draft = await ctx.core.upsertDraft(
      ctx.conversation.vendorId,
      {
        image_keys: ctx.imageKeys,
        input_text: p.text,
        extracted: toDraftExtracted(extraction),
        questions: extraction.questions,
      },
      ctx.call,
    );
    await ctx.reportDraftUsage(draft.id);
    ctx.state.draftId = draft.id;
    ctx.state.draftAnswers = {};
    rememberAmounts(ctx, extraction.price.value);
    const first = extraction.questions[0];
    if (first)
      ctx.out.quickReplies = first.choices
        .slice(0, 4)
        .map((c, i) => ({ id: `${first.id}:${i}`, label: c }));
    else
      ctx.out.quickReplies = [
        { id: 'draft_confirm', label: 'Valider' },
        { id: 'draft_edit', label: 'Modifier' },
      ];
    return { draft, extraction, check_with_vendor: lowConfidenceFields(extraction) };
  },
});

const answerDraftQuestion = tool({
  name: 'answer_draft_question',
  description: 'Enregistre la réponse du vendeur à une question du brouillon.',
  input: z.strictObject({
    draft_id: z.uuid(),
    question_id: z.string(),
    answer: z.string().min(1).max(200),
  }),
  async run(p, ctx) {
    const answers = { ...(ctx.state.draftAnswers ?? {}), [p.question_id]: p.answer };
    ctx.state.draftAnswers = answers;
    ctx.out.quickReplies = [
      { id: 'draft_confirm', label: 'Valider' },
      { id: 'draft_edit', label: 'Modifier' },
    ];
    return { ok: true, draft_id: p.draft_id, answers };
  },
});

const confirmProductDraft = tool({
  name: 'confirm_product_draft',
  description:
    'Publie le brouillon dans le catalogue. Seulement après que le vendeur a validé le résumé. mode="restock" ajoute le stock à un produit existant (target_product_id).',
  input: z.strictObject({
    draft_id: z.uuid(),
    mode: z.enum(['new', 'restock']),
    target_product_id: z.uuid().optional(),
  }),
  async run(p, ctx) {
    const product = await ctx.core.confirmDraft(
      p.draft_id,
      {
        mode: p.mode,
        target_product_id: p.target_product_id ?? null,
        answers: ctx.state.draftAnswers ?? {},
      },
      ctx.call,
    );
    ctx.state.draftId = undefined;
    ctx.state.draftAnswers = undefined;
    rememberAmounts(ctx, product.price);
    return { product, product_url: `${ctx.profile.store_url}/p/${product.id}` };
  },
});

const adjustStock = tool({
  name: 'adjust_stock',
  description:
    'Change le stock d’une variante (« plus que 2 en 42 » : set_to=2, options {size:"42"} ; « +5 en 40 » : delta=5, reason="restock").',
  input: z.strictObject({
    product_ref: z.string().describe('titre ou product_id'),
    options: z.record(z.string(), z.string()).optional(),
    set_to: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
    reason: z.enum(['restock', 'adjustment']),
  }),
  async run(p, ctx) {
    if ((p.set_to === undefined) === (p.delta === undefined))
      return { error: 'VALIDATION_FAILED', hint: 'Donne exactement un de set_to et delta.' };
    const product = await resolveProduct(ctx, p.product_ref);
    if ('error' in product) return product;
    const matches = product.variants.filter((v) =>
      Object.entries(p.options ?? {}).every(
        ([k, val]) => v.options[k]?.toLowerCase() === val.toLowerCase(),
      ),
    );
    if (matches.length !== 1)
      return {
        error: matches.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
        variants: product.variants.map((v) => ({ variant_id: v.id, options: v.options })),
        hint: 'Précise la taille ou la couleur.',
      };
    const variant = matches[0] as (typeof matches)[number];
    const body =
      p.set_to !== undefined
        ? { set_to: p.set_to, reason: p.reason }
        : { delta: p.delta, reason: p.reason };
    const key = createHash('sha256')
      .update(JSON.stringify([ctx.call.requestId, variant.id, body]))
      .digest('hex')
      .slice(0, 40);
    return ctx.core.adjustStock(ctx.conversation.vendorId, variant.id, body, key, ctx.call);
  },
});

const updatePrice = tool({
  name: 'update_price',
  description: 'Change le prix d’un produit (« la robe wax passe à 17 000 »).',
  input: z.strictObject({ product_ref: z.string(), price: money }),
  async run(p, ctx) {
    const product = await resolveProduct(ctx, p.product_ref);
    if ('error' in product) return product;
    const updated = await ctx.core.updateProduct(
      ctx.conversation.vendorId,
      product.id,
      { price: p.price },
      ctx.call,
    );
    rememberAmounts(ctx, product.price, updated.price);
    const change =
      product.price.amount > 0
        ? Math.abs(p.price.amount - product.price.amount) / product.price.amount
        : 1;
    return { product: updated, previous_price: product.price, large_change: change > 0.3 };
  },
});

const listOrders = tool({
  name: 'list_orders',
  description: 'Commandes du vendeur (« commandes du jour »).',
  input: z.strictObject({
    status: z.enum(['pending_payment', 'paid', 'fulfilled', 'cancelled', 'expired']).optional(),
    period: z.enum(['today', '7d']).optional(),
  }),
  async run(p, ctx) {
    const list = await ctx.core.listOrders(ctx.conversation.vendorId, p, ctx.call);
    rememberAmounts(ctx, ...list.data.map((o) => o.total));
    return list;
  },
});

const markFulfilled = tool({
  name: 'mark_fulfilled',
  description: 'Marque une commande payée comme livrée ou expédiée (« A7K2 livrée »).',
  input: z.strictObject({ number: orderNumber }),
  async run(p, ctx) {
    const o = await ctx.core.fulfillOrder(
      ctx.conversation.vendorId,
      p.number.toUpperCase(),
      ctx.call,
    );
    rememberAmounts(ctx, o.total);
    return o;
  },
});

const getMetrics = tool({
  name: 'get_metrics',
  description: 'Ventes et commandes sur une période (« mes ventes de la semaine »).',
  input: z.strictObject({ period: z.enum(['today', '7d', '30d']) }),
  async run(p, ctx) {
    const m = await ctx.core.getMetrics(ctx.conversation.vendorId, p.period, ctx.call);
    ctx.out.amounts.add(m.revenue.xof);
    ctx.out.amounts.add(m.revenue.sat);
    return m;
  },
});

const setBotMode = tool({
  name: 'set_bot_mode',
  description:
    'Met en pause ou relance l’assistant de vente, pour toutes les discussions ou une seule.',
  input: z.strictObject({
    scope: z.enum(['all', 'conversation']),
    mode: z.enum(['bot', 'paused']),
    minutes: z.number().int().min(1).max(1440).optional(),
  }),
  async run(p, ctx) {
    if (p.scope === 'conversation')
      return {
        error: 'NOT_SUPPORTED',
        hint: 'Pour une seule discussion, le vendeur utilise le bouton « Reprendre la main » dans la boîte de réception.',
      };
    await ctx.setBotMode(p.scope, p.mode, p.minutes);
    return { ok: true, mode: p.mode, minutes: p.minutes ?? null };
  },
});

export const SALES_TOOLS = [
  searchProducts,
  getProduct,
  quoteCart,
  createOrder,
  getOrderStatus,
  getShopInfo,
  handoff,
];
export const VENDOR_TOOLS = [
  createProductDraft,
  answerDraftQuestion,
  confirmProductDraft,
  adjustStock,
  updatePrice,
  listOrders,
  markFulfilled,
  getMetrics,
  setBotMode,
];

export function toolsFor(role: 'customer' | 'vendor') {
  return role === 'customer' ? SALES_TOOLS : VENDOR_TOOLS;
}

const definitionCache = new Map<string, LlmToolDef[]>();
/** Tool definitions in a fixed order, so the cached prompt prefix never changes between turns. */
export function toolDefinitions(role: 'customer' | 'vendor'): LlmToolDef[] {
  const hit = definitionCache.get(role);
  if (hit) return hit;
  const defs = toolsFor(role).map((t) => {
    const { $schema: _, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
  definitionCache.set(role, defs);
  return defs;
}

/** What the model sees when core refuses (section 7.4, column "Agent"). */
function describeCoreError(err: CoreError, ctx: ToolContext): Record<string, unknown> {
  const p = err.problem ?? {};
  switch (err.code) {
    case 'OUT_OF_STOCK':
      return { error: err.code, available: p.errors, hint: 'Propose une autre taille ou couleur.' };
    case 'PRICE_CHANGED':
      return {
        error: err.code,
        new_quote: p.quote,
        hint: 'Annonce le nouveau total et redemande l’accord du client.',
      };
    case 'PAYMENT_UNAVAILABLE':
    case 'RATE_UNAVAILABLE':
      ctx.out.handoff = {
        reason: 'payment_unavailable',
        summary: `Paiement indisponible (${err.code}) pendant une commande.`,
      };
      return {
        error: err.code,
        hint: 'Excuse-toi : le paiement est momentanément indisponible, le vendeur est prévenu.',
      };
    case 'TOO_MANY_PENDING_ORDERS':
      return {
        error: err.code,
        hint: 'Explique qu’il y a déjà trop de commandes en attente de paiement pour ce client.',
      };
    case 'VALIDATION_FAILED':
      return {
        error: err.code,
        details: p.errors ?? p.detail,
        hint: 'Demande au client l’information manquante.',
      };
    case 'NOT_FOUND':
      return { error: err.code, hint: 'Introuvable. Vérifie la référence avec le client.' };
    case 'STORE_PAUSED':
      return { error: err.code, hint: 'La boutique ne prend pas de commandes pour le moment.' };
    default:
      return {
        error: err.code,
        hint: 'Erreur technique. Ne promets rien ; propose de passer la main au vendeur.',
      };
  }
}

export interface ToolOutcome {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  result: string;
}

/** Validates the model's input, runs the tool, and returns a JSON string for the model. */
export async function runTool(
  role: 'customer' | 'vendor',
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const spec = toolsFor(role).find((t) => t.name === name);
  if (!spec)
    return { name, arguments: input, ok: false, result: JSON.stringify({ error: 'UNKNOWN_TOOL' }) };
  const parsed = spec.input.safeParse(input);
  if (!parsed.success) {
    return {
      name,
      arguments: input,
      ok: false,
      result: JSON.stringify({
        error: 'INVALID_INPUT',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      }),
    };
  }
  try {
    const result = await spec.run(parsed.data, ctx);
    const failed = typeof result === 'object' && result !== null && 'error' in result;
    return { name, arguments: input, ok: !failed, result: JSON.stringify(result) };
  } catch (err) {
    if (err instanceof CoreError)
      return {
        name,
        arguments: input,
        ok: false,
        result: JSON.stringify(describeCoreError(err, ctx)),
      };
    throw err;
  }
}
