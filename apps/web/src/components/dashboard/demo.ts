// The demo shop (/app?demo): the draft's data in core's shapes, answered in memory, so the dashboard can be
// shown without a session or a running core. Writes change this memory only, for this tab.

import { ApiError } from '@/lib/browser-api';
import type { PlansResponse } from '@/lib/vendor-types';
import type {
  BtcXofRate,
  Category,
  ChatMessage,
  ConversationSummary,
  DashboardMetrics,
  DashboardPeriod,
  Draft,
  SubscriptionInvoice,
  SubscriptionView,
  Vendor,
  VendorOrder,
  VendorProduct,
  Wallet,
} from './types';

const DAY = 86_400_000;
const XOF_PER_SAT = 0.5904;
const now = () => new Date();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const xof = (amount: number) => ({ amount, currency: 'XOF' as const });
const sats = (n: number) => Math.round(n / XOF_PER_SAT);
let seq = 100;
const id = (p: string) => `${p}-${(seq++).toString(16).padStart(4, '0')}-demo`;

const categories: Category[] = [
  { id: 'cat-maro', name: 'Maroquinerie', slug: 'maroquinerie', position: 0 },
  { id: 'cat-chau', name: 'Chaussures', slug: 'chaussures', position: 1 },
  { id: 'cat-pap', name: 'Prêt-à-porter', slug: 'pret-a-porter', position: 2 },
  { id: 'cat-acc', name: 'Accessoires', slug: 'accessoires', position: 3 },
];

function product(
  title: string,
  category_id: string,
  price: number,
  variants: [Record<string, string>, number, number][],
): VendorProduct {
  return {
    id: id('prod'),
    title,
    description: '',
    category_id,
    price: xof(price),
    status: 'active',
    images: [],
    variants: variants.map(([options, on_hand, reserved]) => ({
      id: id('var'),
      sku: null,
      options,
      price_override: null,
      on_hand,
      reserved,
      available: on_hand - reserved,
    })),
    created_at: ago(20 * DAY),
    updated_at: ago(2 * DAY),
  };
}

const products: VendorProduct[] = [
  product('Sac Niani', 'cat-maro', 28500, [[{ color: 'cognac' }, 10, 2]]),
  product('Sandales Téranga', 'cat-chau', 18500, [
    [{ size: '41' }, 6, 1],
    [{ size: '42' }, 9, 2],
  ]),
  product('Ensemble Saly', 'cat-pap', 32000, [
    [{ size: 'M' }, 3, 1],
    [{ size: 'L' }, 2, 0],
  ]),
  product('Pochette Baobab', 'cat-acc', 12500, [[{}, 7, 0]]),
  product('Foulard Thiès', 'cat-acc', 9000, [[{}, 15, 0]]),
];
const [sac, sandales, ensemble, pochette] = products as [
  VendorProduct,
  VendorProduct,
  VendorProduct,
  VendorProduct,
];

function order(
  number: string,
  name: string,
  phone: string,
  p: VendorProduct,
  options: Record<string, string>,
  status: VendorOrder['status'],
  createdAgo: number,
  address: string,
): VendorOrder {
  const total = p.price.amount;
  const created = ago(createdAgo);
  return {
    id: id('ord'),
    number,
    status,
    attention: null,
    channel: 'web',
    customer: { display_name: name, phone_e164: phone },
    items: [{ title: p.title, options, quantity: 1, unit_price: p.price }],
    subtotal: xof(total),
    delivery_fee: xof(0),
    discount: xof(0),
    total: xof(total),
    total_sat: sats(total),
    delivery: { method: 'delivery', zone_id: null, address_text: address, note: null },
    conversation_id: null,
    expires_at: new Date(Date.parse(created) + 20 * 60_000).toISOString(),
    paid_at:
      status === 'pending_payment'
        ? null
        : new Date(Date.parse(created) + 3 * 60_000).toISOString(),
    fulfilled_at: status === 'fulfilled' ? ago(createdAgo - 3 * 3600_000) : null,
    cancelled_at: null,
    cancel_reason: null,
    created_at: created,
  };
}

const orders: VendorOrder[] = [
  order(
    'K7Q2',
    'Aminata Fall',
    '+221771234567',
    sac,
    { color: 'cognac' },
    'pending_payment',
    4 * 60_000,
    'Dakar, Plateau',
  ),
  order(
    'H3M9',
    'Moussa Diop',
    '+221769876543',
    sandales,
    { size: '42' },
    'paid',
    70 * 60_000,
    'Médina, rue 11',
  ),
  order(
    'B8D4',
    'Fatou Ndiaye',
    '+221705551212',
    ensemble,
    { size: 'M' },
    'paid',
    26 * 3600_000,
    'Almadies',
  ),
  order(
    'T2W6',
    'Ibrahima Sarr',
    '+221781112233',
    pochette,
    {},
    'fulfilled',
    30 * 3600_000,
    'Parcelles Assainies',
  ),
];

const conversations: (ConversationSummary & { messages: ChatMessage[] })[] = [];
function conversation(
  label: string,
  mode: ConversationSummary['mode'],
  unread: number,
  lines: [ChatMessage['author'], string, number][],
) {
  const cid = id('conv');
  const messages: ChatMessage[] = lines.map(([author, text, minutesAgo]) => ({
    id: id('msg'),
    conversation_id: cid,
    author,
    author_label: author === 'vendor' ? 'Aïssatou' : null,
    kind: 'text',
    text,
    cards: [],
    quick_replies: [],
    media_key: null,
    client_message_id: null,
    status: 'processed',
    created_at: ago(minutesAgo * 60_000),
  }));
  const last = messages.at(-1) as ChatMessage;
  conversations.push({
    id: cid,
    channel: 'web',
    customer_label: label,
    mode,
    human_until: mode === 'human' ? new Date(Date.now() + 25 * 60_000).toISOString() : null,
    unread_count: unread,
    order_number: null,
    last_message: { author: last.author, text: last.text, created_at: last.created_at },
    created_at: messages[0]?.created_at ?? last.created_at,
    messages,
  });
}
conversation('Aminata Fall', 'human', 1, [
  ['customer', 'Bonjour, le sac Niani est toujours disponible ?', 5],
  ['agent', 'Bonjour Aminata ! Oui, il en reste 8. Le sac Niani est à 28 500 FCFA.', 4],
  ['customer', 'Je peux le récupérer demain à la boutique ?', 2],
  ['system', 'L’assistant a passé la main au vendeur.', 2],
]);
conversation('Moussa Diop', 'bot', 0, [
  ['customer', 'Les sandales existent en 42 ?', 75],
  ['agent', 'Oui, la pointure 42 est disponible à 18 500 FCFA.', 74],
  ['customer', 'Merci, paiement envoyé.', 69],
]);
conversation('Khady Ba', 'bot', 0, [
  ['customer', 'Vous livrez aux Parcelles ?', 22 * 60],
  ['agent', 'Oui, la livraison aux Parcelles coûte 1 500 FCFA, sous 24 h.', 22 * 60 - 1],
]);

const drafts: Draft[] = [
  {
    id: id('draft'),
    status: 'needs_review',
    source: 'dashboard',
    image_keys: ['demo/baskets.jpg'],
    input_text: 'Baskets en cuir écru à 24 000, du 40 au 44',
    extracted: {
      title: { value: 'Baskets en cuir écru', confidence: 0.88, from: 'image' },
      description: {
        value: 'Baskets basses en cuir, semelle claire.',
        confidence: 0.7,
        from: 'image',
      },
      category: { value: 'Chaussures', confidence: 0.92, from: 'image' },
      price: { value: xof(24000), confidence: 0.98, from: 'text' },
      variants: ['40', '41', '42', '43', '44'].map((size) => ({ options: { size } })),
    },
    questions: [
      {
        id: 'stock_split',
        text: 'Combien de paires par pointure ?',
        choices: ['1 par pointure', '2 par pointure', '5 au total'],
      },
    ],
    matches: [],
    created_at: ago(3 * 3600_000),
    confirmed_at: null,
  },
  {
    id: id('draft'),
    status: 'needs_review',
    source: 'assistant',
    image_keys: ['demo/sac.jpg'],
    input_text: null,
    extracted: {
      title: { value: 'Sac bandoulière tissé', confidence: 0.64, from: 'image' },
      category: { value: 'Maroquinerie', confidence: 0.8, from: 'image' },
      price: { value: xof(19500), confidence: 0.55, from: 'price_tag' },
      variants: [{ options: {}, on_hand: 3 }],
    },
    questions: [],
    matches: [{ product_id: sac.id, title: sac.title, similarity: 0.42 }],
    created_at: ago(28 * 3600_000),
    confirmed_at: null,
  },
];

let wallet: Wallet | null = {
  kind: 'nwc',
  status: 'active',
  methods: ['make_invoice', 'lookup_invoice', 'get_info', 'get_balance'],
  notifications: true,
  receive_only: true,
  relays: ['wss://relay.example'],
  lud16: null,
  balance_sat: 186240,
  checked_at: ago(4 * 60_000),
  last_error: null,
};

const plans: PlansResponse = {
  data: (
    [
      ['starter', 'Starter', 5000, 30, 300, 10],
      ['pro', 'Pro', 15000, 200, 1500, 100],
      ['business', 'Business', 40000, 1000, 6000, 500],
    ] as const
  ).map(([pid, name, monthly, products, turns, drafts]) => ({
    id: pid,
    name,
    monthly_price_sat: monthly,
    periods: [
      {
        months: 1 as const,
        price_sat: monthly,
        discount_pct: 0,
        indicative_xof: Math.round(monthly * XOF_PER_SAT),
      },
      {
        months: 3 as const,
        price_sat: monthly * 3 * 0.95,
        discount_pct: 5,
        indicative_xof: Math.round(monthly * 3 * 0.95 * XOF_PER_SAT),
      },
      {
        months: 12 as const,
        price_sat: monthly * 10,
        discount_pct: 17,
        indicative_xof: Math.round(monthly * 10 * XOF_PER_SAT),
      },
    ],
    limits: {
      products,
      agent_turns_per_month: turns,
      drafts_per_month: drafts,
      voice_notes: pid !== 'starter',
      nostr_dm_alerts: pid !== 'starter',
      powered_by_badge: pid === 'starter',
      embed_widget: pid === 'business',
      support:
        pid === 'starter' ? 'help_pages' : pid === 'pro' ? 'two_working_days' : 'one_working_day',
    },
  })),
  trial: { plan_id: 'pro', days: 14 },
  grace_days: 7,
  rate: {
    xof_per_btc: Math.round(XOF_PER_SAT * 1e8),
    source: 'demo',
    quoted_at: new Date().toISOString(),
  },
};

const invoices: SubscriptionInvoice[] = [];
const assistant: ChatMessage[] = [];
const sessions = [
  {
    id: 'sess-1',
    device_label: 'Chrome sur Android',
    created_at: ago(9 * DAY),
    last_seen_at: ago(60_000),
    current: true,
  },
  {
    id: 'sess-2',
    device_label: 'Safari sur Mac',
    created_at: ago(20 * DAY),
    last_seen_at: ago(3 * DAY),
    current: false,
  },
];

/** What the demo vendor changed in Réglages, merged over the defaults (settings one level deep, like core). */
let vendorPatch: {
  display_name?: string;
  contact_whatsapp_e164?: string | null;
  settings?: Record<string, unknown>;
} = {};

function vendor(): Vendor {
  const base: Vendor = {
    id: 'vendor-demo',
    display_name: 'Atelier Niani',
    slug: 'atelier-niani',
    contact_whatsapp_e164: '+221771234567',
    locale: 'fr',
    status: 'active',
    store_url: 'https://selly.sn/s/atelier-niani',
    live: wallet !== null,
    accepting_orders: wallet !== null,
    live_blockers: wallet ? [] : ['wallet_missing'],
    created_at: ago(40 * DAY),
    settings: {
      pricing_currency: 'XOF',
      agent: { enabled: true, tone: 'friendly' },
      alerts: { web_push: true },
    },
  };
  return {
    ...base,
    ...(vendorPatch.display_name ? { display_name: vendorPatch.display_name } : {}),
    ...(vendorPatch.contact_whatsapp_e164 !== undefined
      ? { contact_whatsapp_e164: vendorPatch.contact_whatsapp_e164 }
      : {}),
    settings: { ...base.settings, ...(vendorPatch.settings as Partial<Vendor['settings']>) },
  };
}

function subscription(): SubscriptionView {
  const pro = plans.data[1] as PlansResponse['data'][number];
  const productCount = products.filter((p) => p.status !== 'archived').length;
  return {
    subscription: {
      plan_id: 'pro',
      next_plan_id: null,
      status: 'active',
      trial: false,
      current_period_start: ago(18 * DAY),
      current_period_end: new Date(Date.now() + 12 * DAY).toISOString(),
      grace_ends_at: null,
    },
    plan: pro,
    usage: {
      products: { used: productCount, limit: 200, remaining: 200 - productCount },
      agent_turns: { used: 188, limit: 1500, remaining: 1312 },
      drafts: { used: 9, limit: 100, remaining: 91 },
    },
    actions: ['renew', 'upgrade', 'downgrade'],
  };
}

/** A smooth, plausible week of sales ending today, plus what was paid in the demo. */
function metrics(period: DashboardPeriod): DashboardMetrics {
  const today = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), now().getUTCDate()));
  const series: DashboardMetrics['series'] = [];
  if (period === 'year') {
    for (let m = 0; m <= today.getUTCMonth(); m++) {
      const orders = 18 + Math.round(10 * Math.sin(m / 1.7) + m * 2.5);
      series.push({
        date: new Date(Date.UTC(today.getUTCFullYear(), m, 1)).toISOString().slice(0, 10),
        orders,
        revenue_xof: orders * 19_500,
      });
    }
  } else {
    const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY);
      const orders =
        1 + Math.round(1.5 + Math.sin((d.getTime() / DAY) * 1.3) * 1.2 + (days - i) / days);
      series.push({
        date: d.toISOString().slice(0, 10),
        orders,
        revenue_xof: orders * 17_250 + (i % 3) * 3500,
      });
    }
  }
  const revenue = series.reduce((n, s) => n + s.revenue_xof, 0);
  return {
    period,
    orders: {
      created: series.reduce((n, s) => n + s.orders, 0) + 2,
      paid: series.reduce((n, s) => n + s.orders, 0),
      fulfilled: series.reduce((n, s) => n + s.orders, 0) - 2,
      pending: orders.filter((o) => o.status === 'pending_payment').length,
      expired: 1,
    },
    revenue: { xof: revenue, sat: sats(revenue) },
    revenue_previous: { xof: Math.round(revenue / 1.124), sat: sats(Math.round(revenue / 1.124)) },
    low_stock: products.flatMap((p) =>
      p.variants
        .filter((v) => v.available <= 3)
        .map((v) => ({
          variant_id: v.id,
          title: p.title,
          options: v.options,
          available: v.available,
        })),
    ),
    chats_waiting: conversations.filter((c) => c.mode === 'human').length,
    agent_turns: 188,
    series,
  };
}

function problem(status: number, code: string, detail: string): never {
  throw new ApiError({ type: 'about:blank', title: detail, status, code, detail });
}

function findVariant(variantId: string) {
  for (const p of products) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) return { p, v };
  }
  return problem(404, 'NOT_FOUND', 'Variante introuvable.');
}

/** Answers like core, from memory. A short delay keeps loading states honest. */
export async function demoRequest<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const method = init.method ?? 'GET';
  const body = (init.body ?? {}) as Record<string, unknown>;
  const url = new URL(path, 'http://demo');
  const p = url.pathname;
  const q = url.searchParams;
  const m = (re: RegExp) => re.exec(p);
  let r: RegExpExecArray | null;
  const ok = (v: unknown) => structuredClone(v) as T;

  if (method === 'GET') {
    if (p === '/vendors/me') return ok(vendor());
    if (p === '/vendors/dashboard/metrics')
      return ok(metrics((q.get('period') as DashboardPeriod) ?? 'today'));
    if (p === '/orders') {
      const status = q.get('status');
      return ok({ data: orders.filter((o) => !status || o.status === status), next_cursor: null });
    }
    if ((r = m(/^\/orders\/([^/]+)$/))) {
      const o = orders.find((x) => x.id === r?.[1]);
      return o ? ok(o) : problem(404, 'NOT_FOUND', 'Commande introuvable.');
    }
    if (p === '/conversations') {
      return ok({
        data: conversations.map(({ messages: _m, ...c }) => c),
        next_cursor: null,
      });
    }
    if ((r = m(/^\/conversations\/([^/]+)\/messages$/))) {
      const c = conversations.find((x) => x.id === r?.[1]);
      if (!c) return problem(404, 'NOT_FOUND', 'Discussion introuvable.');
      c.unread_count = 0;
      return ok({ data: c.messages, next_cursor: null });
    }
    if (p === '/inventory') {
      const text = (q.get('q') ?? '').toLowerCase();
      return ok({
        data: products.filter(
          (x) => x.status !== 'archived' && x.title.toLowerCase().includes(text),
        ),
        next_cursor: null,
      });
    }
    if (p === '/vendors/me/categories') return ok({ data: categories });
    if (p === '/inventory/drafts') {
      const status = q.get('status');
      return ok({ data: drafts.filter((d) => !status || d.status === status), next_cursor: null });
    }
    if (p === '/vendors/me/wallet')
      return wallet
        ? ok({ ...wallet, checked_at: ago(60_000) })
        : problem(404, 'NOT_FOUND', 'Aucun portefeuille.');
    if (p === '/vendors/me/subscription') return ok(subscription());
    if (p === '/vendors/me/subscription/invoices') return ok({ data: invoices, next_cursor: null });
    if ((r = m(/^\/vendors\/me\/subscription\/invoices\/([^/]+)$/))) {
      const inv = invoices.find((x) => x.id === r?.[1]);
      return inv ? ok(inv) : problem(404, 'NOT_FOUND', 'Facture introuvable.');
    }
    if (p === '/plans') return ok(plans);
    if (p === '/rates/btc-xof')
      return ok({
        xof_per_btc: Math.round(XOF_PER_SAT * 1e8),
        xof_per_sat: XOF_PER_SAT,
        quoted_at: new Date().toISOString(),
      } satisfies BtcXofRate);
  }

  if ((r = m(/^\/orders\/([^/]+)\/fulfill$/))) {
    const o = orders.find((x) => x.id === r?.[1]);
    if (!o) return problem(404, 'NOT_FOUND', 'Commande introuvable.');
    if (o.status !== 'paid')
      return problem(422, 'VALIDATION_FAILED', 'Seule une commande payée peut être expédiée.');
    o.status = 'fulfilled';
    o.fulfilled_at = new Date().toISOString();
    return ok(o);
  }
  if ((r = m(/^\/orders\/([^/]+)\/cancel$/))) {
    const o = orders.find((x) => x.id === r?.[1]);
    if (!o) return problem(404, 'NOT_FOUND', 'Commande introuvable.');
    o.status = 'cancelled';
    o.cancelled_at = new Date().toISOString();
    o.cancel_reason = String(body.reason ?? '');
    return ok(o);
  }
  if ((r = m(/^\/conversations\/([^/]+)\/messages$/))) {
    const c = conversations.find((x) => x.id === r?.[1]);
    if (!c) return problem(404, 'NOT_FOUND', 'Discussion introuvable.');
    const msg: ChatMessage = {
      id: id('msg'),
      conversation_id: c.id,
      author: 'vendor',
      author_label: 'Aïssatou',
      kind: 'text',
      text: String(body.text ?? ''),
      cards: [],
      quick_replies: [],
      media_key: null,
      client_message_id: null,
      status: 'accepted',
      created_at: new Date().toISOString(),
    };
    c.messages.push(msg);
    c.mode = 'human';
    c.human_until = new Date(Date.now() + 30 * 60_000).toISOString();
    c.last_message = { author: 'vendor', text: msg.text, created_at: msg.created_at };
    return ok(msg);
  }
  if ((r = m(/^\/conversations\/([^/]+)\/mode$/))) {
    const c = conversations.find((x) => x.id === r?.[1]);
    if (!c) return problem(404, 'NOT_FOUND', 'Discussion introuvable.');
    c.mode = body.mode as ConversationSummary['mode'];
    c.human_until = c.mode === 'human' ? new Date(Date.now() + 30 * 60_000).toISOString() : null;
    return ok({ id: c.id, mode: c.mode, human_until: c.human_until });
  }
  if ((r = m(/^\/inventory\/variants\/([^/]+)\/adjustments$/))) {
    const { v } = findVariant(r[1] as string);
    const next =
      typeof body.set_to === 'number' ? body.set_to : v.on_hand + Number(body.delta ?? 0);
    if (next < v.reserved)
      return problem(
        422,
        'VALIDATION_FAILED',
        'Le stock ne peut pas descendre sous les articles réservés.',
      );
    v.on_hand = next;
    v.available = v.on_hand - v.reserved;
    return ok({ variant: v });
  }
  if (p === '/inventory' && method === 'POST') {
    const variants =
      (body.variants as { options: Record<string, string>; on_hand: number }[]) ?? [];
    const created = product(
      String(body.title),
      String(body.category_id ?? ''),
      (body.price as { amount: number }).amount,
      variants.map((x) => [x.options, x.on_hand, 0]),
    );
    created.category_id = (body.category_id as string) ?? null;
    created.description = String(body.description ?? '');
    products.unshift(created);
    return ok(created);
  }
  if ((r = m(/^\/inventory\/([^/]+)$/)) && method === 'PATCH') {
    const prod = products.find((x) => x.id === r?.[1]);
    if (!prod) return problem(404, 'NOT_FOUND', 'Produit introuvable.');
    Object.assign(prod, body);
    return ok(prod);
  }
  if ((r = m(/^\/inventory\/drafts\/([^/]+)\/(confirm|discard)$/))) {
    const d = drafts.find((x) => x.id === r?.[1]);
    if (!d) return problem(404, 'NOT_FOUND', 'Brouillon introuvable.');
    if (r[2] === 'discard') {
      d.status = 'discarded';
      return ok(d);
    }
    const edits = (body.edits ?? {}) as Record<string, unknown>;
    const title = String(edits.title ?? d.extracted?.title?.value ?? 'Produit');
    const price =
      (edits.price as { amount: number } | undefined) ?? d.extracted?.price?.value ?? xof(0);
    const variants =
      (edits.variants as { options: Record<string, string>; stock: number }[] | undefined) ?? [];
    if (body.mode === 'restock' && body.target_product_id) {
      const target = products.find((x) => x.id === body.target_product_id);
      const first = target?.variants[0];
      if (first) {
        first.on_hand += variants.reduce((n, v) => n + (v.stock ?? 0), 0);
        first.available = first.on_hand - first.reserved;
      }
    } else {
      const cat = categories.find(
        (c) => c.name === (edits.category ?? d.extracted?.category?.value),
      );
      products.unshift(
        product(
          title,
          cat?.id ?? '',
          price.amount,
          (variants.length ? variants : [{ options: {}, stock: 1 }]).map((v) => [
            v.options,
            v.stock ?? 0,
            0,
          ]),
        ),
      );
    }
    d.status = 'confirmed';
    d.confirmed_at = new Date().toISOString();
    return ok(products[0]);
  }
  if (p === '/inventory/restock-ai' || p === '/media/uploads') {
    return problem(
      422,
      'VALIDATION_FAILED',
      'L’ajout depuis une photo n’est pas disponible en démo.',
    );
  }
  if (p === '/vendors/me/wallet' && method === 'DELETE') {
    wallet = null;
    return ok({});
  }
  if (p === '/vendors/me/wallet' && method === 'PUT') {
    wallet = {
      ...(wallet ?? ({} as Wallet)),
      kind: 'nwc',
      status: 'active',
      methods: ['make_invoice', 'lookup_invoice', 'get_balance'],
      notifications: true,
      receive_only: true,
      relays: ['wss://relay.example'],
      lud16: null,
      balance_sat: 0,
      checked_at: new Date().toISOString(),
      last_error: null,
    };
    return ok(wallet);
  }
  if (p === '/vendors/me/subscription/invoices' && method === 'POST') {
    const plan = plans.data.find((x) => x.id === body.plan_id);
    const period = plan?.periods.find((x) => x.months === body.months);
    if (!plan || !period) return problem(422, 'VALIDATION_FAILED', 'Formule inconnue.');
    const inv: SubscriptionInvoice = {
      id: id('inv'),
      status: 'pending',
      plan_id: plan.id,
      months: period.months,
      list_price_sat: period.price_sat,
      credit_sat: 0,
      amount_sat: period.price_sat,
      bolt11: 'lnbc-demo-invoice',
      lightning_uri: 'lightning:lnbc-demo-invoice',
      description: `Selly ${plan.name} ${period.months} mois`,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: new Date().toISOString(),
      covers: {
        from: new Date().toISOString(),
        to: new Date(Date.now() + period.months * 30 * DAY).toISOString(),
      },
      settled_at: null,
    };
    invoices.unshift(inv);
    return ok(inv);
  }
  if (p === '/vendors/me' && method === 'PATCH') {
    const { settings, ...rest } = body as typeof vendorPatch;
    vendorPatch = { ...vendorPatch, ...rest, settings: { ...vendorPatch.settings, ...settings } };
    return ok(vendor());
  }
  if (p === '/vendors/me/categories' && method === 'POST') {
    const name = String(body.name ?? '');
    const c = { id: id('cat'), name, slug: name.toLowerCase(), position: categories.length };
    categories.push(c);
    return ok(c);
  }
  if ((r = m(/^\/vendors\/me\/categories\/([^/]+)$/)) && method === 'DELETE') {
    const i = categories.findIndex((c) => c.id === r?.[1]);
    if (i >= 0) categories.splice(i, 1);
    for (const prod of products) if (prod.category_id === r[1]) prod.category_id = null;
    return ok({});
  }
  if (p === '/vendors/me/subscription/trial') return ok(subscription());
  if (p === '/assistant/messages' && method === 'GET')
    return ok({ data: assistant, next_cursor: null });
  if (p === '/assistant/messages' && method === 'POST') {
    const say = (author: ChatMessage['author'], text: string): ChatMessage => ({
      id: id('msg'),
      conversation_id: 'assistant-demo',
      author,
      author_label: null,
      kind: 'text',
      text,
      cards: [],
      quick_replies: [],
      media_key: null,
      client_message_id: null,
      status: 'processed',
      created_at: new Date().toISOString(),
    });
    const message = say('vendor', String(body.text ?? body.quick_reply_id ?? ''));
    const paidCount = orders.filter((o) => o.status === 'paid' || o.status === 'fulfilled').length;
    const reply = say(
      'agent',
      `En démo, je ne modifie rien. Pour info : ${paidCount} commandes payées et ${products.length} produits au catalogue.`,
    );
    assistant.push(message, reply);
    return ok({ message, reply });
  }
  if (p === '/vendors/me/keys')
    return ok({
      data: [
        {
          pubkey: 'b8bd0c19507e241ba3b4d0aaa58c7bb567e05d8643a90277f0b72ad44f110786',
          label: 'Téléphone d’Aïssatou',
          created_at: ago(40 * DAY),
          last_used_at: ago(2 * 3600_000),
        },
      ],
    });
  if (p === '/auth/sessions' && method === 'GET')
    return ok({
      data: sessions,
    });
  if ((r = m(/^\/auth\/sessions\/([^/]+)$/)) && method === 'DELETE') {
    const i = sessions.findIndex((s) => s.id === r?.[1]);
    if (i >= 0) sessions.splice(i, 1);
    return ok({});
  }
  if (p === '/auth/logout') return ok({});
  return problem(404, 'NOT_FOUND', `Pas de données de démo pour ${method} ${p}.`);
}
