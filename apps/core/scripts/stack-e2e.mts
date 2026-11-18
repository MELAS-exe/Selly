// End to end against a running stack: real PostgreSQL, S3 storage, a Nostr relay and two core processes. The
// wallets are the testkit's fake NWC wallets (real NIP-47 over the relay), running in this process.
//
//   pnpm --filter @selly/core exec tsx scripts/stack-e2e.mts
//
// Environment (defaults match the local e2e stack):
//   CORE_A, CORE_B        the two core processes (http://localhost:4000, http://localhost:4001)
//   RELAY_HOST, RELAY_CORE the relay as this script reaches it, and as core reaches it
//   STORAGE               the S3 endpoint as browsers reach it (http://localhost:9000)
//   CORE_CONTAINER_CLI    a command that runs core's CLI in the stack, for the platform wallet
//   SERVICE_TOKEN         the agent's service token
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { FakeNwcWallet } from '@selly/nwc/testkit';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import sharp from 'sharp';

const A = process.env.CORE_A ?? 'http://localhost:4000';
const B = process.env.CORE_B ?? 'http://localhost:4001';
const RELAY_HOST = process.env.RELAY_HOST ?? 'ws://localhost:7000';
const RELAY_CORE = process.env.RELAY_CORE ?? 'ws://relay:8080';
const STORAGE = process.env.STORAGE ?? 'http://localhost:9000';
const CLI =
  process.env.CORE_CONTAINER_CLI ?? 'docker compose exec -T -e NWC_URI core node dist/cli.js';
const TOKEN = process.env.SERVICE_TOKEN ?? 'dev-agent-token';
const ORIGIN = 'http://localhost:3000';

const results: { step: string; ok: boolean; detail: string }[] = [];
function check(step: string, ok: boolean, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail ? `: ${detail}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms: number) {
  const start = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - start < ms) {
    await sleep(250);
    v = await fn();
  }
  return { value: v, ms: Date.now() - start, ok: ok(v) };
}

/** A browser session: cookie jar for one vendor, against either core process. */
class Session {
  cookie = '';
  async call(
    base: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        origin: ORIGIN,
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith('selly_session=')) this.cookie = set.split(';')[0] as string;
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
}

const internal = (base: string, method: string, path: string, body?: unknown, actor?: string) =>
  fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(actor ? { 'x-actor': actor } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

/** Reads an SSE stream into a string, until closed. */
function stream(url: string, cookie?: string) {
  const ctrl = new AbortController();
  let text = '';
  const ready = fetch(url, { headers: cookie ? { cookie } : {}, signal: ctrl.signal }).then(
    async (res) => {
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            text += dec.decode(value);
          }
        } catch {}
      })();
      return res.status;
    },
  );
  return { ready, text: () => text, close: () => ctrl.abort() };
}

const coreUri = (w: FakeNwcWallet) =>
  w.uri.replace(encodeURIComponent(RELAY_HOST), encodeURIComponent(RELAY_CORE));

async function signIn(s: Session, base: string, sk = generateSecretKey()) {
  const c = await s.call(base, 'POST', '/api/v1/auth/nostr/challenges', { purpose: 'sign_in' });
  const event = finalizeEvent(c.body.event_template, sk);
  const r = await s.call(base, 'POST', '/api/v1/auth/nostr/sessions', {
    challenge_id: c.body.challenge_id,
    event,
    device_label: 'stack e2e',
  });
  return { status: r.status, sk };
}

const wallets: FakeNwcWallet[] = [];
async function wallet() {
  const w = await FakeNwcWallet.start({ relayUrl: RELAY_HOST });
  wallets.push(w);
  return w;
}

async function main() {
  // ------------------------------------------------------------------ both processes, storage rules
  for (const base of [A, B]) {
    const h = await fetch(`${base}/healthz`)
      .then((r) => r.json())
      .catch(() => null);
    check(`health ${base}`, h?.status === 'ok');
  }
  const list = await fetch(`${STORAGE}/selly-public?list-type=2`);
  check('public bucket cannot be listed anonymously', list.status === 403, `HTTP ${list.status}`);

  // ------------------------------------------------------------------ platform wallet (operator CLI)
  const platform = await wallet();
  try {
    // Not execSync: the fake wallet runs in this process and must keep answering while the CLI checks it.
    const { stdout: out } = await promisify(exec)(`${CLI} wallet:link --platform`, {
      env: { ...process.env, NWC_URI: coreUri(platform) },
      cwd: process.env.STACK_DIR ?? process.cwd(),
      encoding: 'utf8',
    });
    check('platform wallet linked with the CLI', out.includes('Linked.'));
  } catch (err) {
    check(
      'platform wallet linked with the CLI',
      false,
      String((err as { stdout?: string }).stdout ?? err),
    );
  }

  // ------------------------------------------------------------------ vendor: sign in, shop, wallet, trial
  const v = new Session();
  const signed = await signIn(v, A);
  check(
    'Nostr sign-in (NIP-98)',
    signed.status === 200 || signed.status === 201,
    `HTTP ${signed.status}`,
  );
  const slug = `e2e-${getPublicKey(signed.sk).slice(0, 8)}`;
  const shop = await v.call(A, 'POST', '/api/v1/vendors', { display_name: 'Boutique E2E', slug });
  // The trial starts with the shop; it is published (live) once a wallet is linked.
  check(
    'shop created on its trial, not published without a wallet',
    shop.status === 201 &&
      shop.body.live === false &&
      JSON.stringify(shop.body.live_blockers) === '["wallet_missing"]',
    JSON.stringify(shop.body.live_blockers),
  );
  const patched = await v.call(B, 'PATCH', '/api/v1/vendors/me', {
    settings: {
      delivery: {
        zones: [{ id: 'plateau', label: 'Dakar Plateau', fee: { amount: 1000, currency: 'XOF' } }],
        pickup: { available: true, address_text: 'Marché HLM' },
      },
    },
  });
  check('settings saved on the other process', patched.status === 200, `HTTP ${patched.status}`);

  const vw = await wallet();
  const linked = await v.call(A, 'PUT', '/api/v1/vendors/me/wallet', {
    kind: 'nwc',
    uri: coreUri(vw),
  });
  check(
    'vendor wallet linked (five checks over the relay)',
    linked.status === 200,
    JSON.stringify(linked.body).slice(0, 120),
  );
  const trial = await v.call(A, 'GET', '/api/v1/vendors/me/subscription');
  check(
    '14-day Pro trial started with the shop',
    trial.body.subscription?.status === 'trialing' && trial.body.subscription?.plan_id === 'pro',
  );
  const again = await v.call(A, 'POST', '/api/v1/vendors/me/subscription/trial', {
    plan_id: 'pro',
  });
  check('no second trial', again.status === 409, again.body.code);
  const me = await v.call(B, 'GET', '/api/v1/vendors/me');
  check(
    'shop is live and takes orders',
    me.body.live === true && me.body.accepting_orders === true,
    JSON.stringify(me.body.live_blockers),
  );

  // ------------------------------------------------------------------ photo upload and product
  const photo = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#8a2be2' },
  })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { ImageDescription: 'GPS 14.69N 17.44W' } } })
    .toBuffer();
  const up = await v.call(A, 'POST', '/api/v1/media/uploads', {
    content_type: 'image/jpeg',
    size_bytes: photo.length,
  });
  check('presigned upload', up.status === 201, up.body.storage_key);
  const put = await fetch(up.body.upload_url, {
    method: 'PUT',
    headers: up.body.headers,
    body: photo,
  });
  check('browser PUT to storage', put.status === 200, `HTTP ${put.status}`);
  const wrongSize = await v.call(A, 'POST', '/api/v1/media/uploads', {
    content_type: 'image/jpeg',
    size_bytes: 10,
  });
  const tooBig = await fetch(wrongSize.body.upload_url, {
    method: 'PUT',
    headers: wrongSize.body.headers,
    body: photo,
  });
  check(
    'storage refuses a size other than the signed one',
    tooBig.status >= 400,
    `HTTP ${tooBig.status}`,
  );
  const priv = await fetch(`${STORAGE}/selly-private/${up.body.storage_key}`);
  check('private original is not readable anonymously', priv.status === 403, `HTTP ${priv.status}`);

  const product = await v.call(
    B,
    'POST',
    '/api/v1/inventory',
    {
      title: 'Robe wax bleue',
      price: { amount: 15000, currency: 'XOF' },
      image_keys: [up.body.storage_key],
      variants: [
        { options: { size: '40' }, on_hand: 2 },
        { options: { size: '42' }, on_hand: 3 },
      ],
    },
    { 'idempotency-key': `e2e-product-${slug}-0001` },
  );
  check(
    'product with photo',
    product.status === 201,
    JSON.stringify(product.body.images?.[0] ?? product.body).slice(0, 140),
  );
  const img = product.body.images?.[0];
  if (img) {
    const r = await fetch(img.url);
    const bytes = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(bytes)
      .metadata()
      .catch(() => null);
    check(
      'public image served, upright, no EXIF',
      r.status === 200 &&
        meta?.format === 'webp' &&
        !meta?.exif &&
        img.width === 640 &&
        img.height === 480,
      `HTTP ${r.status} ${meta?.format} ${img.width}x${img.height} exif=${!!meta?.exif}`,
    );
    const avif = await fetch(img.url.replace('/640.webp', '/960.avif'));
    check(
      'AVIF variant served',
      avif.status === 200 && (avif.headers.get('content-type') ?? '').includes('avif'),
    );
  }
  const store = await fetch(`${A}/api/v1/stores/${slug}`).then((r) => r.json());
  check(
    'storefront lists the product',
    store.products?.some((p: { title: string }) => p.title === 'Robe wax bleue'),
  );

  // ------------------------------------------------------------------ customer order, paid over NWC
  const variant42 = product.body.variants?.find(
    (x: { options: { size: string } }) => x.options.size === '42',
  );
  const vendorEvents = stream(`${B}/api/v1/vendors/me/events`, v.cookie);
  await vendorEvents.ready;
  const orderRes = await fetch(`${A}/api/v1/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `e2e-order-${slug}-00001` },
    body: JSON.stringify({
      store_slug: slug,
      channel: 'web',
      customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
      items: [{ variant_id: variant42?.id, quantity: 1 }],
      delivery: {
        method: 'delivery',
        zone_id: 'plateau',
        address_text: 'Rue 10',
        note: 'Appeler avant',
      },
      expected_total: { amount: 16000, currency: 'XOF' },
    }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  check(
    'order created with an invoice from the vendor wallet',
    orderRes.status === 201,
    `${orderRes.body.invoice?.amount_msat} msat`,
  );
  const order = orderRes.body;
  if (orderRes.status === 201) {
    // The checkout page listens on the other process; the 60 s poll means only a signal can wake it.
    const checkout = stream(`${B}/api/v1/checkout/${order.order.public_token}/events`);
    await checkout.ready;
    await until(
      async () => checkout.text(),
      (t) => t.includes('pending_payment'),
      5000,
    );
    const paidAt = Date.now();
    await vw.pay(order.invoice.payment_hash);
    const paid = await until(
      async () => checkout.text(),
      (t) => t.includes('"status":"paid"'),
      20000,
    );
    // Under 3 s: the wallet's notification, not the 5 s reconciler, must settle it (the leader subscribes on link).
    const latency = Date.now() - paidAt;
    check(
      'checkout stream on the other process sees the payment',
      paid.ok && latency < 3000,
      `${latency} ms after paying`,
    );
    checkout.close();
    const ev = await until(
      async () => vendorEvents.text(),
      (t) => t.includes('event: order.paid'),
      5000,
    );
    check('dashboard stream gets order.paid', ev.ok);

    const stock = await v.call(A, 'GET', '/api/v1/inventory');
    const p = stock.body.data?.find((x: { title: string }) => x.title === 'Robe wax bleue');
    const v42 = p?.variants?.find((x: { options: { size: string } }) => x.options.size === '42');
    check('stock committed', v42?.on_hand === 2, `on_hand ${v42?.on_hand}`);
    const ful = await v.call(B, 'PATCH', `/api/v1/orders/${order.order.id}/fulfill`, {
      note: 'Livrée',
    });
    check('order fulfilled', ful.status === 200 && ful.body.status === 'fulfilled');
    const metrics = await v.call(A, 'GET', '/api/v1/vendors/dashboard/metrics?period=7d');
    check(
      'metrics count it',
      metrics.body.orders?.fulfilled === 1,
      JSON.stringify(metrics.body.orders),
    );
  }

  // ------------------------------------------------------------------ subscription paid on the platform wallet
  const inv = await v.call(
    A,
    'POST',
    '/api/v1/vendors/me/subscription/invoices',
    { plan_id: 'pro', months: 1 },
    {
      'idempotency-key': `e2e-sub-${slug}-000001`,
    },
  );
  check(
    'subscription invoice on the platform wallet',
    inv.status === 201,
    `${inv.body.amount_sat} sats`,
  );
  if (inv.status === 201) {
    await platform.pay(inv.body.payment_hash);
    const settled = await until(
      () => v.call(B, 'GET', `/api/v1/vendors/me/subscription/invoices/${inv.body.id}`),
      (r) => r.body.status === 'settled',
      20000,
    );
    check('subscription invoice settled', settled.ok && settled.ms < 3000, `${settled.ms} ms`);
    const sub = await v.call(A, 'GET', '/api/v1/vendors/me/subscription');
    check(
      'paid during the trial: active, still on trial until it ends',
      sub.body.subscription?.status === 'active' && sub.body.subscription?.trial === true,
    );
  }

  // ------------------------------------------------------------------ photo draft, with the agent simulated
  const draft = await v.call(
    A,
    'POST',
    '/api/v1/inventory/restock-ai',
    { image_keys: [up.body.storage_key], text: 'Baskets à 20 000, 3 en 41' },
    {
      'idempotency-key': `e2e-draft-${slug}-0001`,
    },
  );
  check('restock-ai draft processing', draft.status === 202 && draft.body.status === 'processing');
  const links = await internal(B, 'POST', `/internal/v1/vendors/${shop.body.id}/media/links`, {
    keys: [up.body.storage_key],
  });
  const link = links.body?.links?.[0]?.url;
  const linkRes = link ? await fetch(link) : null;
  check(
    'agent read link to the private original works',
    linkRes?.status === 200,
    `HTTP ${linkRes?.status}`,
  );
  const upsert = await internal(B, 'POST', `/internal/v1/vendors/${shop.body.id}/product-drafts`, {
    draft_id: draft.body.id,
    image_keys: [up.body.storage_key],
    extracted: {
      title: { value: 'Baskets blanches', confidence: 0.9, from: 'text' },
      description: { value: 'Toile', confidence: 0.6, from: 'image' },
      category: { value: 'chaussures', confidence: 0.7, from: 'inferred' },
      price: { value: { amount: 20000, currency: 'XOF' }, confidence: 0.95, from: 'text' },
      variants: { value: [{ options: { size: '41' }, stock: 3 }], confidence: 0.8, from: 'text' },
    },
    questions: [],
  });
  check(
    'agent sends the extraction back',
    upsert.status === 201 && upsert.body.status === 'needs_review',
  );
  const ready = await until(
    async () => vendorEvents.text(),
    (t) => t.includes('event: draft.ready'),
    5000,
  );
  check('dashboard stream gets draft.ready', ready.ok);
  const confirmed = await internal(
    A,
    'POST',
    `/internal/v1/vendors/${shop.body.id}/product-drafts/${draft.body.id}/confirm`,
    { mode: 'new' },
    `vendor:${shop.body.id}`,
  );
  check(
    'draft confirmed into a product with its photo',
    confirmed.status === 201 && confirmed.body.images?.length === 1,
  );
  vendorEvents.close();

  // ------------------------------------------------------------------ scopes
  const noToken = await fetch(`${A}/internal/v1/vendors/${shop.body.id}/entitlements`);
  check('internal route without a token is refused', noToken.status === 401);

  // ------------------------------------------------------------------ pairing (nostr+walletauth)
  const w2 = new Session();
  await signIn(w2, B);
  const shop2 = await w2.call(B, 'POST', '/api/v1/vendors', {
    display_name: 'Boutique Pairing',
    slug: `${slug}-p`,
  });
  const pairing = await w2.call(B, 'POST', '/api/v1/vendors/me/wallet/pairing', {});
  check(
    'pairing link',
    pairing.status === 201 && pairing.body.open_uri?.startsWith('nostr+walletauth://'),
  );
  if (pairing.status === 201) {
    const approved = await FakeNwcWallet.approve(pairing.body.open_uri, { relayUrl: RELAY_HOST });
    wallets.push(approved);
    const w = await until(
      () => w2.call(A, 'GET', '/api/v1/vendors/me/wallet'),
      (r) => r.status === 200,
      30000,
    );
    check('wallet approved in the wallet app is linked', w.ok, `${w.ms} ms`);
  }
  void shop2;

  // ------------------------------------------------------------------ summary
  for (const x of wallets) x.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
