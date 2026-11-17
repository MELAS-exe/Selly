// Environment of the agent service (architecture.md section 11.3).

import { randomBytes } from 'node:crypto';

export const DEV_SECRETS = {
  SERVICE_TOKEN_AGENT: 'dev-agent-token',
  EVENTS_HMAC_SECRET: 'dev-events-secret',
} as const;

export interface AgentConfig {
  nodeEnv: string;
  port: number;
  appBaseUrl: string;
  /** Base URL of core's internal API. Empty means the in-memory fake core (local demo and tests). */
  coreUrl: string;
  serviceToken: string;
  eventsHmacSecret: string;
  /** Empty means the in-memory store. */
  databaseUrl: string;
  /** `scripted`, `demo`, or a Claude model id such as `claude-opus-5-5`. */
  llmPrimary: string;
  llmFallback: string;
  /** Seconds the turn waits for more messages from the same person (section 8.2). */
  mergeWindowMs: number;
  /** Deadline for one whole turn (section 8.2). */
  turnDeadlineMs: number;
  /** Minutes a vendor message keeps the chat in `human` mode (section 6.6). */
  humanMinutes: number;
  /** Whether `POST /internal/v1/agent/chat` is enabled: only with AGENT_TEST_ENDPOINT=true. */
  testEndpoint: boolean;
  /** Number of proxies in front of the agent whose X-Forwarded-For is trusted (0: none). */
  trustProxyHops: number;
  /** Salt of the stored IP hashes; random per process unless IP_HASH_SALT is set. */
  ipHashSalt: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  return {
    nodeEnv,
    port: Number(env.AGENT_PORT ?? 4100),
    appBaseUrl: (env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    coreUrl:
      env.AGENT_CORE_MODE === 'fake'
        ? ''
        : (env.CORE_URL_INTERNAL ?? env.CORE_URL ?? '').replace(/\/$/, ''),
    serviceToken: env.SERVICE_TOKEN_AGENT || DEV_SECRETS.SERVICE_TOKEN_AGENT,
    eventsHmacSecret: env.EVENTS_HMAC_SECRET || DEV_SECRETS.EVENTS_HMAC_SECRET,
    databaseUrl: env.AGENT_STORE === 'memory' ? '' : (env.DATABASE_URL ?? ''),
    llmPrimary: env.LLM_PRIMARY || 'scripted',
    llmFallback: env.LLM_FALLBACK ?? '',
    mergeWindowMs: Number(env.AGENT_MERGE_WINDOW_MS ?? 1500),
    turnDeadlineMs: Number(env.AGENT_TURN_DEADLINE_MS ?? 12_000),
    humanMinutes: Number(env.AGENT_HUMAN_MINUTES ?? 30),
    testEndpoint: env.AGENT_TEST_ENDPOINT === 'true',
    trustProxyHops: Number(env.TRUST_PROXY ?? 0),
    ipHashSalt: env.IP_HASH_SALT || randomBytes(16).toString('hex'),
  };
}

/**
 * In production the agent refuses to start with a missing or development secret: anyone who knows
 * `dev-events-secret` could sign a core event and put a link in a customer's chat. A local stack in
 * production mode allows them explicitly with ALLOW_DEV_SECRETS=true, as core does.
 */
export function checkSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  if ((env.NODE_ENV ?? 'development') !== 'production' || env.ALLOW_DEV_SECRETS === 'true')
    return [];
  const problems: string[] = [];
  for (const [name, devValue] of Object.entries(DEV_SECRETS)) {
    const value = env[name];
    if (!value) problems.push(`${name} is not set`);
    else if (value === devValue) problems.push(`${name} has its development value`);
    else if (value.length < 16) problems.push(`${name} is shorter than 16 characters`);
  }
  if (env.AGENT_TEST_ENDPOINT === 'true')
    problems.push('AGENT_TEST_ENDPOINT must not be true in production');
  return problems;
}
