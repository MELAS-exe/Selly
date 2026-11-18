// A fake Lightning wallet for local demos, from the testkit (packages/nwc/src/testkit): two receive-only NWC wallets,
// one for a vendor and one for the platform (subscriptions), speaking real NIP-47 over the local relay. No channel,
// no liquidity: invoices settle when you say so. Dev only, never in production.
//
//   pnpm dev:testwallet                    run both wallets (keep the terminal open) and print their links
//   pnpm testwallet link --slug <shop>     link the vendor wallet to a shop with core's CLI (wallet:link)
//   pnpm testwallet link --platform        link the platform wallet
//   pnpm testwallet invoices               list the invoices the wallets made
//   pnpm testwallet pay [bolt11|hash]      the customer pays: the newest unpaid invoice, or the one given
//
// Core must run with INVOICE_PROVIDER=nwc and NWC_ALLOW_INSECURE_RELAYS=true (the relay is ws://).
// TESTWALLET_RELAY  relay URL, default ws://localhost:7777 (the relay service of docker-compose.yml)
// TESTWALLET_PORT   control API on 127.0.0.1, default 7788
// The wallet keys are kept in .testwallet.json at the repository root, so the links survive a restart; the
// invoices do not (they live in memory, as in a real wallet that was reset).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { FakeNwcWallet } from '@selly/nwc/testkit';

const ROOT = new URL('../../../', import.meta.url);
const STATE = new URL('.testwallet.json', ROOT);
const RELAY = process.env.TESTWALLET_RELAY ?? 'ws://localhost:7777';
const PORT = Number(process.env.TESTWALLET_PORT ?? 7788);
const API = `http://127.0.0.1:${PORT}`;

type Role = 'vendor' | 'platform';
type Keys = { walletSecret: string; clientSecret: string };

function loadKeys(): Record<Role, Keys> {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  const make = () => ({
    walletSecret: randomBytes(32).toString('hex'),
    clientSecret: randomBytes(32).toString('hex'),
  });
  const keys = { vendor: make(), platform: make() };
  writeFileSync(STATE, `${JSON.stringify(keys, null, 2)}\n`);
  return keys;
}

const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function serve() {
  const keys = loadKeys();
  const wallets = {} as Record<Role, FakeNwcWallet>;
  for (const role of ['vendor', 'platform'] as const)
    wallets[role] = await FakeNwcWallet.start({ relayUrl: RELAY, keys: keys[role] });

  const all = () =>
    (['vendor', 'platform'] as const).flatMap((role) =>
      wallets[role].listInvoices().map((i) => ({ wallet: role, ...i })),
    );

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/uris')
        return send(res, 200, { vendor: wallets.vendor.uri, platform: wallets.platform.uri });
      if (req.method === 'GET' && req.url === '/invoices') return send(res, 200, all());
      if (req.method === 'POST' && req.url === '/pay') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const ref = String((JSON.parse(raw || '{}') as { ref?: string }).ref ?? '').trim();
        const found = ref
          ? all().find(
              (i) =>
                i.paymentHash === ref.toLowerCase() ||
                wallets[i.wallet].hashOf(ref) === i.paymentHash,
            )
          : all().find((i) => i.state === 'pending');
        if (!found)
          return send(res, 404, {
            error: ref ? 'No invoice from these wallets matches.' : 'No unpaid invoice.',
          });
        if (found.state === 'settled') return send(res, 409, { error: 'Already paid.', ...found });
        await wallets[found.wallet].pay(found.paymentHash);
        return send(res, 200, { ...found, state: 'settled' });
      }
      send(res, 404, { error: 'Not found.' });
    } catch (err) {
      send(res, 500, { error: String((err as Error).message ?? err) });
    }
  });
  // Localhost only: anyone who can reach this can "pay" invoices.
  server.listen(PORT, '127.0.0.1');

  console.log(`Fake wallets online on ${RELAY} (receive only: get_info, get_balance, make_invoice, lookup_invoice,
and payment_received notifications; no pay_invoice).

Vendor wallet:
  ${wallets.vendor.uri}

Platform wallet (subscriptions):
  ${wallets.platform.uri}

Core needs INVOICE_PROVIDER=nwc and NWC_ALLOW_INSECURE_RELAYS=true. Then, in another terminal:
  pnpm testwallet link --slug <your-shop>     or paste the vendor link in the dashboard (Portefeuille)
  pnpm testwallet link --platform
  pnpm testwallet pay                         pays the newest unpaid invoice

Control API on ${API}. Ctrl+C to stop.`);

  const stop = () => {
    server.close();
    for (const w of Object.values(wallets)) w.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, init).catch(() => {
    console.error(`The fake wallets are not running. Start them first: pnpm dev:testwallet`);
    process.exit(1);
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function link(args: string[]) {
  const platform = args.includes('--platform');
  const slug = args[args.indexOf('--slug') + 1] ?? '';
  // A shop slug, checked before it goes on a command line.
  if (!platform && (!args.includes('--slug') || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug))) {
    console.error('Usage: pnpm testwallet link --slug <shop> | --platform');
    process.exit(2);
  }
  const { body: uris } = await api<Record<Role, string>>('/uris');
  // core's own CLI: the same five checks as the dashboard, over the relay. The flag allows the ws:// relay for
  // this command only; it is a development setting that core also needs to use the wallet afterwards.
  // One command string through the shell, so pnpm resolves on Windows too (pnpm.cmd).
  const child = spawn(
    `pnpm --filter @selly/core cli wallet:link ${platform ? '--platform' : `--slug ${slug}`}`,
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        NWC_URI: platform ? uris.platform : uris.vendor,
        NWC_ALLOW_INSECURE_RELAYS: 'true',
      },
    },
  );
  child.on('exit', (code) => process.exit(code ?? 1));
}

const sats = (msat: number) => `${Math.round(msat / 1000).toLocaleString('fr-FR')} sats`;

async function invoices() {
  const { body } =
    await api<
      {
        wallet: Role;
        paymentHash: string;
        amountMsat: number;
        state: string;
        description: string;
      }[]
    >('/invoices');
  if (body.length === 0)
    return console.log('No invoices yet (they are kept in memory until the wallets stop).');
  for (const i of body)
    console.log(
      `${i.state.padEnd(8)} ${i.wallet.padEnd(8)} ${sats(i.amountMsat).padStart(14)}  ${i.paymentHash}  ${i.description}`,
    );
}

async function pay(ref: string | undefined) {
  const { status, body } = await api<{
    error?: string;
    wallet: Role;
    amountMsat: number;
    paymentHash: string;
    description: string;
  }>('/pay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  if (status !== 200) {
    console.error(body.error);
    process.exit(1);
  }
  console.log(`Paid ${sats(body.amountMsat)} to the ${body.wallet} wallet: ${body.description}
${body.paymentHash}
Core hears it from the payment_received notification (or its next lookup) and marks the order paid.`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'serve') await serve();
else if (command === 'link') await link(rest);
else if (command === 'invoices') await invoices();
else if (command === 'pay') await pay(rest[0]);
else {
  console.error(
    'Usage: pnpm dev:testwallet | pnpm testwallet link --slug <shop> | link --platform | invoices | pay [bolt11|hash]',
  );
  process.exit(2);
}
