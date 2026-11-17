import { createDb, runMigrations } from '@selly/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Context, type Database, silentLogger } from './context';
import { seedDemo } from './dev/seed';
import { PgLeader } from './leader';
import { purgeOldChallenges } from './modules/auth/service';
import { deliverAlerts, nostrDmSender, webPushSender } from './modules/events/alerts';
import { dispatchOnce } from './modules/events/dispatcher';
import { purgeOldNotifications } from './modules/events/notifications';
import { failStaleDrafts } from './modules/inventory/drafts';
import { objectStoreFromConfig } from './modules/media/storage';
import { FakeInvoiceProvider } from './modules/payments/fake';
import { NwcGateway } from './modules/payments/nwc-gateway';
import { singleProvider } from './modules/payments/provider';
import { confirmPayment, reconcileLateOnce, reconcileOnce } from './modules/payments/service';
import { feedsFromConfig } from './modules/rates/feeds';
import { RateService } from './modules/rates/service';
import {
  confirmSubscriptionPayment,
  reconcileLateSubscriptionInvoices,
  reconcileSubscriptionInvoices,
  runSubscriptionJob,
} from './modules/subscriptions/billing';
import { PairingWatcher } from './modules/wallet/pairing';
import { linkWallet, liveWallet } from './modules/wallet/service';
import { Keyring } from './secrets';
import { PgSignals, Signals } from './signals';

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

  const { db: pgDb, pool, close } = createDb(config.DATABASE_URL);
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
    media: objectStoreFromConfig(config),
    signals: new Signals(),
    keyring,
    log: silentLogger,
  };
  const app = buildApp(ctx);
  ctx.log = app.log;
  const signals = new PgSignals(pool, app.log);
  ctx.signals = signals;
  await signals.start();
  if (config.NODE_ENV === 'production' && config.MEDIA_STORE === 'memory')
    app.log.warn(
      'MEDIA_STORE=memory: uploads live in this process and are lost on restart. Use s3.',
    );

  let gateway: NwcGateway | null = null;
  if (config.INVOICE_PROVIDER === 'nwc') {
    gateway = new NwcGateway(
      ctx,
      (n) => {
        confirmPayment(ctx, n).catch((err) =>
          app.log.warn({ err: String(err), ...n }, 'payment notification not confirmed'),
        );
      },
      (n) => {
        confirmSubscriptionPayment(ctx, n).catch((err) =>
          app.log.warn({ err: String(err), ...n }, 'subscription payment not confirmed'),
        );
      },
    );
    ctx.invoices = gateway;
    // The platform wallet that receives subscriptions: linked from the environment on first start, with the same
    // checks as the CLI. A wallet already linked is kept; replace it with `cli wallet:link --platform`.
    const platformUri = process.env.SECRETS_PLATFORM_NWC_URI;
    if (platformUri && !(await liveWallet(db, { owner: 'platform' }))) {
      await linkWallet(ctx, { owner: 'platform', uri: platformUri, actor: 'operator:env' })
        .then(() => app.log.info('platform wallet linked from SECRETS_PLATFORM_NWC_URI'))
        .catch((err) =>
          app.log.error({ err: String(err) }, 'SECRETS_PLATFORM_NWC_URI could not be linked'),
        );
    }
    app.log.info({ network: config.LIGHTNING_NETWORK }, 'NWC gateway ready');
  } else {
    app.log.warn(
      'INVOICE_PROVIDER=fake: invoices are simulated and cannot be paid. Development only.',
    );
  }

  // Wallet pairing (nostr+walletauth): needs the key that encrypts the pairing secrets.
  const pairing = keyring ? new PairingWatcher(ctx) : null;

  // Background work runs on one process only, the job leader (advisory lock). Wallet notification subscriptions
  // and the pairing watcher follow the leadership; HTTP requests are served by every process.
  const leader = new PgLeader(pool, app.log, (leading) => {
    if (leading) {
      gateway
        ?.refresh()
        .catch((err) => app.log.warn({ err: String(err) }, 'wallet refresh failed'));
    } else {
      gateway?.unsubscribeAll();
      pairing?.close();
    }
  });
  await leader.start();

  const timers: NodeJS.Timeout[] = [];
  /** Runs `fn` every `ms` on the leader, never twice at once. */
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    if (ms <= 0) return;
    let running = false;
    timers.push(
      setInterval(async () => {
        if (running || !leader.isLeader()) return;
        running = true;
        try {
          await fn();
        } catch (err) {
          app.log.error({ err }, `${name} failed`);
        } finally {
          running = false;
        }
      }, ms),
    );
  };

  // Reconciler: asks wallets about open invoices and expires unpaid orders (architecture.md 7.3).
  every(config.RECONCILE_INTERVAL_MS, 'reconciler', async () => {
    await reconcileOnce(ctx, app.log);
    await reconcileSubscriptionInvoices(ctx, app.log);
  });
  // Invoices paid after they expired (architecture.md 4.4).
  every(config.LATE_PAYMENT_INTERVAL_MS, 'late payment check', async () => {
    await reconcileLateOnce(ctx, app.log);
    await reconcileLateSubscriptionInvoices(ctx, app.log);
  });
  // Event dispatcher: delivers the outbox to the agent, signed, in order per order.
  every(config.EVENTS_DISPATCH_INTERVAL_MS, 'event dispatch', () =>
    dispatchOnce(ctx, { agentUrl: config.AGENT_URL, secret: config.EVENTS_HMAC_SECRET }),
  );
  // Subscription status job (grace, suspension, booked plans, reminders) and drafts the agent never answered.
  every(config.SUBSCRIPTION_JOB_INTERVAL_MS, 'subscription job', async () => {
    await runSubscriptionJob(ctx);
    await failStaleDrafts(ctx);
  });
  // Alerts outside the dashboard: Web Push and Nostr direct messages.
  const senders = {
    push: webPushSender(config),
    dm: nostrDmSender(
      config.SECRETS_PLATFORM_NOSTR_KEY,
      config.NOSTR_DM_RELAYS.split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  };
  if (!senders.push) app.log.warn('No VAPID keys: Web Push alerts are off.');
  every(config.ALERTS_INTERVAL_MS, 'alerts', () => deliverAlerts(ctx, senders));
  // Housekeeping: old dashboard notifications and sign-in challenges.
  every(3_600_000, 'cleanup', async () => {
    await purgeOldNotifications(db, now());
    await purgeOldChallenges(db, now());
  });
  if (gateway) every(WALLET_REFRESH_MS, 'wallet refresh', () => (gateway as NwcGateway).refresh());
  if (pairing) every(5_000, 'pairing refresh', () => pairing.refresh());

  const shutdown = async () => {
    for (const t of timers) clearInterval(t);
    pairing?.close();
    gateway?.close();
    leader.close();
    signals.close();
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
