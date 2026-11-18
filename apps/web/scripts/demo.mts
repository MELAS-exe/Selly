// Local demo of the vendor dashboard, without a real wallet and without changing core.
//
//   pnpm --filter @selly/web demo
//
// Needs: `pnpm infra:up` (PostgreSQL and the Nostr relay on ws://localhost:7777), and core running with
// INVOICE_PROVIDER=nwc, NWC_ALLOW_INSECURE_RELAYS=true and a SECRETS_KEK_V1 (local .env only).
//
// What it does:
// 1. Gives the demo shop (awa-style, created by SEED_DEMO) a dev Nostr key, saved in apps/web/.demo/vendor.json.
//    Sign in with it from a NIP-07 extension (import the nsec), or let the Playwright scripts inject it.
// 2. Starts the testkit's fake NWC wallet on the local relay (real NIP-47) and links it to the demo shop with
//    core's own CLI. It keeps running: it is the shop's wallet, it makes the invoices and can pay them.
// 3. Listens on http://localhost:4310:
//      POST /order?pay_after=3   a customer (Fatou) orders the white sneakers and pays 3 s later
//      POST /pay?hash=<payment_hash>   pay an invoice of this wallet
// Stop with Ctrl+C: the shop's wallet goes offline and the dashboard shows it.

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeNwcWallet } from '@selly/nwc/testkit';
import { nip19 } from 'nostr-tools';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const CORE = process.env.CORE_URL ?? 'http://localhost:4000';
const RELAY = process.env.DEMO_RELAY ?? 'ws://localhost:7777';
const SLUG = process.env.DEMO_SLUG ?? 'awa-style';
const PORT = Number(process.env.DEMO_PORT ?? 4310);
const stateFile = join(here, '../.demo/vendor.json');

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'selly', '-d', 'selly', '-tAc', sql],
    { cwd: root, encoding: 'utf8' },
  ).trim();
}

// 1. The dev key.
type State = { secret_hex: string; pubkey: string; nsec: string; npub: string };
let state: State;
if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8'));
else {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  state = {
    secret_hex: Buffer.from(sk).toString('hex'),
    pubkey,
    nsec: nip19.nsecEncode(sk),
    npub: nip19.npubEncode(pubkey),
  };
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
const vendorId = psql(`select id from core.vendors where slug = '${SLUG}'`);
if (!vendorId) throw new Error(`No shop "${SLUG}". Start core once with SEED_DEMO=true.`);
psql(
  `insert into core.vendor_keys (pubkey, vendor_id, label) values ('${state.pubkey}', '${vendorId}', 'demo key') on conflict (pubkey) do nothing`,
);
console.log(`Demo key for ${SLUG}: ${state.npub}`);
console.log(`  secret (dev only, also in apps/web/.demo/vendor.json): ${state.nsec}`);

// 2. The shop's wallet.
const wallet = await FakeNwcWallet.start({ relayUrl: RELAY, notifications: true });
// Async on purpose: the wallet answers core from this very process, so its event loop must stay free.
const linked = await new Promise<{ code: number | null; out: string }>((resolve) => {
  const child = spawn('pnpm', ['--filter', '@selly/core', 'cli', 'wallet:link', '--slug', SLUG], {
    cwd: root,
    env: { ...process.env, NWC_URI: wallet.uri },
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  child.stderr.on('data', (d) => {
    out += d;
  });
  child.on('close', (code) => resolve({ code, out }));
});
if (linked.code !== 0) {
  console.error(linked.out);
  throw new Error('Linking the fake wallet failed. Is core running with INVOICE_PROVIDER=nwc?');
}
console.log(`Fake wallet linked to ${SLUG} (relay ${RELAY}).`);

// 3. A customer, on demand.
async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await fetch(CORE + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as T;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

type ProductDetail = {
  variants: { id: string; options: Record<string, string>; availability: string }[];
};
type Quote = { total: { amount: number; currency: string } };
type Created = {
  order: { number: string };
  invoice: { payment_hash: string };
  checkout_url: string;
};

async function order(payAfterSec: number) {
  const product = await call<ProductDetail>(
    'GET',
    `/api/v1/stores/${SLUG}/products/baskets-blanches`,
  );
  const variant =
    product.variants.find((v) => v.options.size === '42' && v.availability !== 'out_of_stock') ??
    product.variants.find((v) => v.availability !== 'out_of_stock');
  if (!variant) throw new Error('No sneakers left in stock.');
  const items = [{ variant_id: variant.id, quantity: 1 }];
  const delivery = {
    method: 'delivery',
    zone_id: 'plateau',
    address_text: 'Rue 10, près de la pharmacie',
  };
  const quote = await call<Quote>('POST', `/api/v1/stores/${SLUG}/cart-quotes`, {
    items,
    delivery,
  });
  const created = await call<Created>(
    'POST',
    '/api/v1/orders',
    {
      store_slug: SLUG,
      channel: 'web',
      customer: { display_name: 'Fatou Diop', phone_e164: '+221771234567' },
      items,
      delivery,
      expected_total: quote.total,
    },
    { 'idempotency-key': randomUUID() },
  );
  console.log(`Order ${created.order.number} created: ${created.checkout_url}`);
  if (payAfterSec >= 0)
    setTimeout(() => {
      wallet
        .pay(created.invoice.payment_hash)
        .then(() => console.log(`Order ${created.order.number} paid.`))
        .catch((e) => console.error('pay failed', e));
    }, payAfterSec * 1000);
  return created;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    let out: unknown;
    if (req.method === 'POST' && url.pathname === '/order')
      out = await order(Number(url.searchParams.get('pay_after') ?? 3));
    else if (req.method === 'POST' && url.pathname === '/pay') {
      await wallet.pay(url.searchParams.get('hash') ?? '');
      out = { paid: true };
    } else if (url.pathname === '/key')
      out = { pubkey: state.pubkey, secret_hex: state.secret_hex };
    else {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e));
  }
}).listen(PORT, () => {
  console.log(`Demo customer on http://localhost:${PORT}  (POST /order?pay_after=3)`);
});

process.on('SIGINT', () => {
  wallet.close();
  process.exit(0);
});
