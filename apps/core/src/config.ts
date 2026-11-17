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
  // 'fake' creates Lightning invoices in memory (development only). 'nwc' is the real gateway (not built yet).
  INVOICE_PROVIDER: z.enum(['fake', 'nwc']).default('fake'),
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
