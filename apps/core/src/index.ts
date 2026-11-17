import { createDb } from '@selly/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { Context, Database } from './context';
import { seedDemo } from './dev/seed';
import { FakeInvoiceProvider } from './modules/payments/fake';
import { singleProvider } from './modules/payments/provider';
import { reconcileOnce } from './modules/payments/service';
import { feedsFromConfig } from './modules/rates/feeds';
import { RateService } from './modules/rates/service';

async function main() {
  const config = loadConfig();
  const { db: pgDb, close } = createDb(config.DATABASE_URL);
  const db = pgDb as unknown as Database;
  const now = () => new Date();

  if (config.MIGRATE_ON_START) {
    await migrate(pgDb, { migrationsFolder: config.MIGRATIONS_DIR });
  }
  if (config.SEED_DEMO) await seedDemo(db);

  if (config.INVOICE_PROVIDER === 'nwc') {
    throw new Error(
      'INVOICE_PROVIDER=nwc: the NWC gateway is not built yet. Use INVOICE_PROVIDER=fake for now.',
    );
  }
  const provider = new FakeInvoiceProvider(now);

  const ctx: Context = {
    config,
    db,
    now,
    rates: new RateService(db, feedsFromConfig(config.RATE_SOURCES), now),
    invoices: singleProvider(provider),
  };
  const app = buildApp(ctx);

  if (config.INVOICE_PROVIDER === 'fake') {
    app.log.warn(
      'INVOICE_PROVIDER=fake: invoices are simulated and cannot be paid. Development only.',
    );
  }

  // Reconciler: asks wallets about open invoices and expires unpaid orders (architecture.md 7.3).
  // pg-boss will replace this timer when more than one instance runs.
  let running = false;
  const timer = setInterval(async () => {
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

  const shutdown = async () => {
    clearInterval(timer);
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
