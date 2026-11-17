import { createDb, runMigrations } from '@selly/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Context, type Database, silentLogger } from './context';
import { seedDemo } from './dev/seed';
import { dispatchOnce } from './modules/events/dispatcher';
import { FakeInvoiceProvider } from './modules/payments/fake';
import { NwcGateway } from './modules/payments/nwc-gateway';
import { singleProvider } from './modules/payments/provider';
import { confirmPayment, reconcileOnce } from './modules/payments/service';
import { feedsFromConfig } from './modules/rates/feeds';
import { RateService } from './modules/rates/service';
import { Keyring } from './secrets';

const WALLET_REFRESH_MS = 60_000;

async function main() {
  const config = loadConfig();
  const keyring = Keyring.fromEnv(process.env);
  if (config.INVOICE_PROVIDER === 'nwc' && !keyring) {
    throw new Error(
      'INVOICE_PROVIDER=nwc needs SECRETS_KEK_V1 (32 random bytes, base64) to decrypt wallet connections. ' +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }

  const { db: pgDb, close } = createDb(config.DATABASE_URL);
  const db = pgDb as unknown as Database;
  const now = () => new Date();

  if (config.MIGRATE_ON_START) {
    await runMigrations(pgDb, config.MIGRATIONS_DIR);
  }
  if (config.SEED_DEMO) await seedDemo(db);

  // The context is completed below: the gateway and the logger need the context and the app in turn.
  const ctx: Context = {
    config,
    db,
    now,
    rates: new RateService(db, feedsFromConfig(config.RATE_SOURCES), now),
    invoices: singleProvider(new FakeInvoiceProvider(now)),
    keyring,
    log: silentLogger,
  };
  const app = buildApp(ctx);
  ctx.log = app.log;

  let gateway: NwcGateway | null = null;
  if (config.INVOICE_PROVIDER === 'nwc') {
    gateway = new NwcGateway(ctx, (n) => {
      confirmPayment(ctx, n).catch((err) =>
        app.log.warn({ err: String(err), ...n }, 'payment notification not confirmed'),
      );
    });
    ctx.invoices = gateway;
    await gateway
      .refresh()
      .catch((err) => app.log.warn({ err: String(err) }, 'wallet refresh failed'));
    app.log.info({ network: config.LIGHTNING_NETWORK }, 'NWC gateway ready');
  } else {
    app.log.warn(
      'INVOICE_PROVIDER=fake: invoices are simulated and cannot be paid. Development only.',
    );
  }

  // Reconciler: asks wallets about open invoices and expires unpaid orders (architecture.md 7.3).
  // pg-boss will replace these timers when more than one instance runs.
  let running = false;
  const reconciler = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await reconcileOnce(ctx, app.log);
    } catch (err) {
      app.log.error({ err }, 'reconciler failed');
    } finally {
      running = false;
    }
  }, config.RECONCILE_INTERVAL_MS);
  // Event dispatcher: delivers the outbox to the agent, signed, in order per order.
  let dispatching = false;
  const dispatcher =
    config.EVENTS_DISPATCH_INTERVAL_MS > 0
      ? setInterval(async () => {
          if (dispatching) return;
          dispatching = true;
          try {
            await dispatchOnce(ctx, {
              agentUrl: config.AGENT_URL,
              secret: config.EVENTS_HMAC_SECRET,
            });
          } catch (err) {
            app.log.error({ err }, 'event dispatch failed');
          } finally {
            dispatching = false;
          }
        }, config.EVENTS_DISPATCH_INTERVAL_MS)
      : null;
  const walletRefresh = gateway
    ? setInterval(() => {
        gateway
          ?.refresh()
          .catch((err) => app.log.warn({ err: String(err) }, 'wallet refresh failed'));
      }, WALLET_REFRESH_MS)
    : null;

  const shutdown = async () => {
    clearInterval(reconciler);
    if (dispatcher) clearInterval(dispatcher);
    if (walletRefresh) clearInterval(walletRefresh);
    gateway?.close();
    await app.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.CORE_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
