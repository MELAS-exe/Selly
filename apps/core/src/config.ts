import path from 'node:path';
import { z } from 'zod';

const DEV_SERVICE_TOKEN_DEFAULT = 'dev-agent-token';
const DEV_EVENTS_SECRET_DEFAULT = 'dev-events-secret';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORE_PORT: z.coerce.number().int().default(4000),
  // Proxies in front of core whose X-Forwarded-For is believed: 1 for the web app, 2 with a CDN in front.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  APP_BASE_URL: z.url().default('http://localhost:3000'),
  CDN_BASE_URL: z.url().default('http://localhost:9000/selly-public'),
  // Where images and voice notes live. 'memory' keeps them in the process (tests, development without MinIO).
  MEDIA_STORE: z.enum(['memory', 's3']).default('memory'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  // The address browsers reach for presigned uploads, when it differs (http://localhost:9000 next to http://minio:9000).
  S3_PRESIGN_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  // MinIO and most S3-compatible services need path-style URLs.
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  S3_BUCKET_PUBLIC: z.string().default('selly-public'),
  S3_BUCKET_PRIVATE: z.string().default('selly-private'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  DATABASE_URL: z.string().default('postgres://selly:selly@localhost:5432/selly'),
  // 'fake' simulates invoices in memory (development only). 'nwc' creates them on each vendor's own wallet.
  INVOICE_PROVIDER: z.enum(['fake', 'nwc']).default('fake'),
  // Invoices from wallets must be for this network (architecture.md section 3.6).
  LIGHTNING_NETWORK: z.enum(['mainnet', 'testnet', 'signet', 'regtest']).default('mainnet'),
  // ws:// relays in NWC URIs. Local tests only: real wallets use wss://.
  NWC_ALLOW_INSECURE_RELAYS: flag,
  // Tests only: Lightning Address servers over http:// on private addresses.
  LNURL_ALLOW_INSECURE: flag,
  // Fallback for subscription invoices when the platform NWC wallet does not answer (LUD-21 required).
  PLATFORM_LUD16: z.string().default(''),
  // Relays where wallets announce a pairing (nostr+walletauth links), comma separated.
  NWC_PAIRING_RELAYS: z.string().default('wss://relay.getalby.com/v1'),
  // At most 2 requests per second per wallet (architecture.md section 7.3).
  NWC_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(500),
  NWC_MAKE_INVOICE_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  NWC_LOOKUP_TIMEOUT_MS: z.coerce.number().int().default(8_000),
  NWC_GET_INFO_TIMEOUT_MS: z.coerce.number().int().default(8_000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().default(5000),
  // Looks up invoices that expired in the last 24 hours, for late payments. 0 turns it off.
  LATE_PAYMENT_INTERVAL_MS: z.coerce.number().int().min(0).default(600_000),
  // Grace, suspension, booked plans and renewal reminders (architecture.md section 4.4). 0 turns the job off.
  SUBSCRIPTION_JOB_INTERVAL_MS: z.coerce.number().int().min(0).default(300_000),
  RATE_SOURCES: z.string().default('kraken,coinbase'),
  SERVICE_TOKEN_AGENT: z.string().min(8).default(DEV_SERVICE_TOKEN_DEFAULT),
  // More service tokens with fewer scopes, as JSON (scopes.ts): [{"name":"ops","token":"...","scopes":["orders:read"]}].
  SERVICE_TOKENS: z.string().default(''),
  // Live streams wake on LISTEN/NOTIFY; this poll is the fallback when that connection is down.
  SSE_POLL_MS: z.coerce.number().int().default(10_000),
  // How often the vendor's live stream checks that its session is still valid.
  VENDOR_STREAM_SESSION_CHECK_MS: z.coerce.number().int().min(10).default(60_000),
  // Where core delivers its events (outbox) and the secret both sides sign them with.
  AGENT_URL: z.url().default('http://localhost:4100'),
  EVENTS_HMAC_SECRET: z.string().min(8).default(DEV_EVENTS_SECRET_DEFAULT),
  // 0 turns the dispatcher off (events stay in the outbox).
  EVENTS_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(0).default(1000),
  // Web Push (VAPID). Without the keys, alerts stay on the dashboard. The web app needs the public key too.
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:support@selly.example'),
  // Nostr direct-message alerts (NIP-17) are sent from this key (64 hex), to these relays.
  SECRETS_PLATFORM_NOSTR_KEY: z.string().default(''),
  NOSTR_DM_RELAYS: z.string().default('wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net'),
  // How often the alert worker runs. 0 turns it off.
  ALERTS_INTERVAL_MS: z.coerce.number().int().min(0).default(5_000),
  // Migrations ship with the image at /app/migrations (see apps/core/Dockerfile). In a checkout they live in packages/db.
  MIGRATIONS_DIR: z.string().default(path.resolve(process.cwd(), '../../packages/db/migrations')),
  MIGRATE_ON_START: flag,
  SEED_DEMO: flag,
});

export type Config = z.infer<typeof schema>;

export const DEV_SERVICE_TOKEN = DEV_SERVICE_TOKEN_DEFAULT;
export const DEV_EVENTS_SECRET = DEV_EVENTS_SECRET_DEFAULT;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  // A production process must not run on the dev token that ships in this repository. The local Docker stack runs
  // NODE_ENV=production with dev values on purpose, and says so with ALLOW_DEV_SECRETS=true.
  if (config.NODE_ENV === 'production' && env.ALLOW_DEV_SECRETS !== 'true') {
    const weak = (name: 'SERVICE_TOKEN_AGENT' | 'EVENTS_HMAC_SECRET', dev: string) =>
      !env[name] || config[name] === dev || config[name].length < 32;
    for (const [name, dev] of [
      ['SERVICE_TOKEN_AGENT', DEV_SERVICE_TOKEN],
      ['EVENTS_HMAC_SECRET', DEV_EVENTS_SECRET],
    ] as const) {
      if (weak(name, dev)) {
        throw new Error(
          `${name} must be set to a random value of at least 32 characters in production ` +
            '(set ALLOW_DEV_SECRETS=true only for a local stack).',
        );
      }
    }
  }
  if (config.NODE_ENV === 'production' && config.SERVICE_TOKENS.trim()) {
    const extra = JSON.parse(config.SERVICE_TOKENS) as { name?: string; token?: string }[];
    const weak = extra.find((t) => (t.token ?? '').length < 32);
    if (weak)
      throw new Error(`SERVICE_TOKENS: the "${weak.name}" token must be at least 32 characters.`);
  }
  return config;
}
