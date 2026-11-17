// Environment of the agent service (architecture.md section 11.3).

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
  /** Whether `POST /internal/v1/agent/chat` is enabled (scope agent:test, never in production). */
  testEndpoint: boolean;
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
    serviceToken: env.SERVICE_TOKEN_AGENT ?? 'dev-agent-token',
    eventsHmacSecret: env.EVENTS_HMAC_SECRET ?? 'dev-events-secret',
    databaseUrl: env.AGENT_STORE === 'memory' ? '' : (env.DATABASE_URL ?? ''),
    llmPrimary: env.LLM_PRIMARY || 'scripted',
    llmFallback: env.LLM_FALLBACK ?? '',
    mergeWindowMs: Number(env.AGENT_MERGE_WINDOW_MS ?? 1500),
    turnDeadlineMs: Number(env.AGENT_TURN_DEADLINE_MS ?? 12_000),
    humanMinutes: Number(env.AGENT_HUMAN_MINUTES ?? 30),
    testEndpoint: nodeEnv !== 'production' || env.AGENT_TEST_ENDPOINT === 'true',
  };
}
