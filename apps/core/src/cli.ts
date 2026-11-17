// Operator commands, until the vendor dashboard can link wallets (PUT /api/v1/vendors/me/wallet needs sign-in).
//
//   wallet:link   --slug <shop> | --platform    link or replace a wallet; reads the NWC URI from NWC_URI or stdin
//   wallet:status --slug <shop> | --platform
//   wallet:unlink --slug <shop> | --platform
//
// The URI is a credential: it is read from the environment or stdin, never from the command line, so it does not
// end up in shell history or the process list.
import { createInterface } from 'node:readline';
import { core, createDb } from '@selly/db';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config';
import type { Database } from './context';
import { AppError } from './errors';
import {
  linkWallet,
  liveWallet,
  unlinkWallet,
  type WalletDeps,
  walletView,
} from './modules/wallet/service';
import { Keyring } from './secrets';

const USAGE = `Usage:
  wallet:link   --slug <shop> | --platform     (NWC URI from NWC_URI or stdin)
  wallet:status --slug <shop> | --platform
  wallet:unlink --slug <shop> | --platform`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readUri(): Promise<string> {
  if (process.env.NWC_URI) return process.env.NWC_URI;
  if (!process.stdin.isTTY) {
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data.trim();
  }
  // Interactive: hide what is typed or pasted.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let prompted = false;
  out._writeToOutput = (s: string) => {
    if (!prompted) {
      out.output.write(s);
      prompted = true;
    } else if (s.includes('\n')) out.output.write('\n');
  };
  const answer = await new Promise<string>((resolve) =>
    rl.question('NWC connection URI (hidden): ', resolve),
  );
  rl.close();
  return answer.trim();
}

async function main() {
  const [command] = process.argv.slice(2);
  const platform = process.argv.includes('--platform');
  const slug = arg('--slug');
  if (!command?.startsWith('wallet:') || (!platform && !slug)) {
    console.error(USAGE);
    process.exit(2);
  }

  const config = loadConfig();
  const { db: pg, close } = createDb(config.DATABASE_URL);
  const db = pg as unknown as Database;
  const deps: WalletDeps = {
    config,
    db,
    now: () => new Date(),
    keyring: Keyring.fromEnv(process.env),
    log: {
      info: () => {},
      warn: (o, m) => console.warn(m, o),
      error: (o, m) => console.error(m, o),
    },
  };

  try {
    let vendorId: string | undefined;
    if (slug) {
      const [v] = await db.select().from(core.vendors).where(eq(core.vendors.slug, slug));
      if (!v) throw new Error(`No shop has the slug "${slug}".`);
      vendorId = v.id;
    }
    const scope = platform
      ? { owner: 'platform' as const }
      : { owner: 'vendor' as const, vendorId: vendorId as string };
    const who = platform ? 'the platform' : slug;

    if (command === 'wallet:link') {
      const uri = await readUri();
      if (!uri) throw new Error('No URI given. Set NWC_URI or pipe the URI on stdin.');
      console.log(`Checking the wallet for ${who}: get_info, permissions, a 1-sat test invoice...`);
      const view = await linkWallet(deps, { ...scope, uri, actor: 'operator:cli' });
      console.log('Linked.', JSON.stringify(view, null, 2));
      console.log('A running core picks the wallet up within a minute (INVOICE_PROVIDER=nwc).');
    } else if (command === 'wallet:status') {
      const row = await liveWallet(db, scope);
      console.log(
        row ? JSON.stringify(walletView(row), null, 2) : `No wallet is linked for ${who}.`,
      );
    } else if (command === 'wallet:unlink') {
      await unlinkWallet(deps, { ...scope, actor: 'operator:cli' });
      console.log(`Unlinked. Also revoke the connection in the wallet app of ${who}.`);
    } else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof AppError)
      console.error(`${err.code}: ${err.detail}`, err.extra.errors ?? '');
    else console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await close();
  }
}

void main();
