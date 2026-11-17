import path from 'node:path';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORE_PORT: z.coerce.number().int().default(4000),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  CDN_BASE_URL: z.url().default('http://localhost:9000/selly-public'),
  DATABASE_URL: z.string().default('postgres://selly:selly@localhost:5432/selly'),
  // 'fake' simulates invoices in memory (development only). 'nwc' creates them on each vendor's own wallet.
  INVOICE_PROVIDER: z.enum(['fake', 'nwc']).default('fake'),
  // Invoices from wallets must be for this network (architecture.md section 3.6).
  LIGHTNING_NETWORK: z.enum(['mainnet', 'testnet', 'signet', 'regtest']).default('mainnet'),
  // ws:// relays in NWC URIs. Local tests only: real wallets use wss://.
  NWC_ALLOW_INSECURE_RELAYS: flag,
  // At most 2 requests per second per wallet (architecture.md section 7.3).
  NWC_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(500),
  NWC_MAKE_INVOICE_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  NWC_LOOKUP_TIMEOUT_MS: z.coerce.number().int().default(8_000),
  NWC_GET_INFO_TIMEOUT_MS: z.coerce.number().int().default(8_000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().default(5000),
  RATE_SOURCES: z.string().default('kraken,coinbase'),
  SERVICE_TOKEN_AGENT: z.string().min(8).default('dev-agent-token'),
  SSE_POLL_MS: z.coerce.number().int().default(2000),
  // Migrations ship with the image at /app/migrations (see apps/core/Dockerfile). In a checkout they live in packages/db.
  MIGRATIONS_DIR: z.string().default(path.resolve(process.cwd(), '../../packages/db/migrations')),
  MIGRATE_ON_START: flag,
  SEED_DEMO: flag,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
