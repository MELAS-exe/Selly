import { ERROR_CODES, type ErrorCode } from '@selly/contracts';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { type AsrProvider, AudioUploads, NoAsr } from './asr';
import { registerAssistantRoutes } from './chat/assistant';
import { VendorAuth } from './chat/auth';
import { EventHub } from './chat/hub';
import { registerInboxRoutes } from './chat/inbox';
import { registerInternalRoutes } from './chat/internal';
import { registerChatRoutes } from './chat/routes';
import { type AgentConfig, loadConfig } from './config';
import { ConversationService } from './conversations';
import { TurnService } from './conversations/turns';
import { type CoreClient, HttpCoreClient } from './core/client';
import { FakeCore } from './core/fake';
import { AgentEngine } from './engine';
import { ClaudeProvider } from './engine/anthropic';
import { DemoProvider } from './engine/demo';
import { FallbackProvider, type LlmProvider } from './engine/llm';
import { ScriptedProvider } from './engine/scripted';
import { AppError, CoreError } from './errors';
import { EntitlementsCache, ProfileCache, RateLimiter, UsageReporter } from './quota';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { AgentStore } from './store/types';
import { type ImageResolver, ProductExtractor, urlImageResolver } from './vision';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface AgentServices {
  config: AgentConfig;
  store: AgentStore;
  core: CoreClient;
  llm: LlmProvider;
  hub: EventHub;
  conversations: ConversationService;
  turns: TurnService;
  engine: AgentEngine;
  extractor: ProductExtractor;
  entitlements: EntitlementsCache;
  profiles: ProfileCache;
  usage: UsageReporter;
  vendorAuth: VendorAuth;
  uploads: AudioUploads;
  limits: {
    sessionsPerIp: RateLimiter;
    messagesPerToken: RateLimiter;
    assistantPerVendor: RateLimiter;
  };
  /** Keeps background work (draft extraction) visible to `turns.idle()` and shutdown. */
  track(p: Promise<unknown>): void;
}

export interface BuildOptions {
  config?: Partial<AgentConfig>;
  store?: AgentStore;
  core?: CoreClient;
  llm?: LlmProvider;
  asr?: AsrProvider;
  imageResolver?: ImageResolver;
}

/** `scripted` (tests), `demo` (local, no key) or a Claude model id. */
export function providerFor(name: string): LlmProvider {
  if (name === 'scripted') return new ScriptedProvider();
  if (name === 'demo') return new DemoProvider();
  if (name.startsWith('claude-')) return new ClaudeProvider({ model: name });
  throw new Error(`Unknown LLM provider "${name}". Use scripted, demo or a Claude model id.`);
}

export function buildApp(opts: BuildOptions = {}): FastifyInstance & { services: AgentServices } {
  const config: AgentConfig = { ...loadConfig(), ...opts.config };
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-selly-signature"]',
            ],
          },
    // Only the known number of proxies: otherwise X-Forwarded-For defeats the per-IP limits.
    trustProxy:
      config.trustProxyHops > 0
        ? (_address: string, hop: number) => hop < config.trustProxyHops
        : false,
    bodyLimit: 64 * 1024,
  });

  // JSON with the raw text kept: core events are signed over the raw body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = text;
    try {
      done(null, text.length > 0 ? JSON.parse(text) : {});
    } catch {
      done(
        new AppError('VALIDATION_FAILED', 'Body is not valid JSON.') as unknown as FastifyError,
        undefined,
      );
    }
  });
  // Voice notes uploaded to the URL returned by POST /chat/uploads.
  app.addContentTypeParser(
    /^audio\//,
    { parseAs: 'buffer', bodyLimit: 2_097_152 },
    (_req, body, done) => done(null, body),
  );

  const store =
    opts.store ??
    (config.databaseUrl ? PostgresStore.connect(config.databaseUrl) : new MemoryStore());
  const core =
    opts.core ??
    (config.coreUrl
      ? new HttpCoreClient(config.coreUrl, config.serviceToken)
      : new FakeCore(config.appBaseUrl));
  const llm =
    opts.llm ??
    (config.llmFallback
      ? new FallbackProvider(providerFor(config.llmPrimary), providerFor(config.llmFallback))
      : providerFor(config.llmPrimary));
  const hub = new EventHub();
  const entitlements = new EntitlementsCache(core);
  const profiles = new ProfileCache(core);
  const usage = new UsageReporter(core, entitlements);
  const conversations = new ConversationService(store, hub, config.humanMinutes);
  const extractor = new ProductExtractor(
    llm,
    opts.imageResolver ?? urlImageResolver(process.env.MEDIA_BASE_URL ?? ''),
    store,
  );
  const engine = new AgentEngine({
    llm,
    core,
    store,
    extractor,
    appBaseUrl: config.appBaseUrl,
    deadlineMs: config.turnDeadlineMs,
  });
  const uploads = new AudioUploads();
  const turns = new TurnService({
    store,
    core,
    engine,
    conversations,
    entitlements,
    usage,
    profiles,
    asr: opts.asr ?? new NoAsr(),
    uploads,
    turnLimiter: new RateLimiter(30, 60 * 60_000),
    mergeWindowMs: config.mergeWindowMs,
    appBaseUrl: config.appBaseUrl,
    log: app.log,
  });
  const services: AgentServices = {
    config,
    store,
    core,
    llm,
    hub,
    conversations,
    turns,
    engine,
    extractor,
    entitlements,
    profiles,
    usage,
    vendorAuth: new VendorAuth(core, config.appBaseUrl),
    uploads,
    limits: {
      sessionsPerIp: new RateLimiter(30, 10 * 60_000),
      messagesPerToken: new RateLimiter(20, 60_000),
      assistantPerVendor: new RateLimiter(30, 60_000),
    },
    track: (p) => turns.track(p),
  };

  app.setErrorHandler((err, req, reply) => {
    let appErr: AppError;
    if (err instanceof AppError) appErr = err;
    else if (err instanceof CoreError) {
      const known = err.code in ERROR_CODES ? (err.code as ErrorCode) : null;
      appErr = known
        ? new AppError(known)
        : new AppError('PROVIDER_TIMEOUT', 'Core is unavailable.');
    } else if ((err as FastifyError).statusCode === 413) {
      appErr = new AppError('VALIDATION_FAILED', 'Body too large.');
    } else if (((err as FastifyError).statusCode ?? 500) < 500) {
      appErr = new AppError('VALIDATION_FAILED', (err as FastifyError).message);
    } else {
      req.log.error({ err }, 'unhandled error');
      reply.code(500).type('application/problem+json').send({
        type: 'about:blank',
        title: 'Internal error',
        status: 500,
        code: 'INTERNAL',
        trace_id: req.id,
      });
      return;
    }
    if (appErr.retryAfterSeconds) reply.header('retry-after', String(appErr.retryAfterSeconds));
    reply
      .code(appErr.status)
      .type('application/problem+json')
      .send(appErr.toProblem(String(req.id)));
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'agent' }));

  registerChatRoutes(app, services);
  registerInboxRoutes(app, services);
  registerAssistantRoutes(app, services);
  registerInternalRoutes(app, services);

  // Housekeeping every 10 minutes: idle SSE buffers, expired chat sessions (30 days without activity).
  const housekeeping = setInterval(() => {
    hub.sweep();
    store
      .purgeExpiredSessions(new Date())
      .catch((err) => app.log.warn({ err }, 'session purge failed'));
  }, 10 * 60_000);
  housekeeping.unref();

  app.addHook('onClose', async () => {
    clearInterval(housekeeping);
    await turns.idle();
    if (store instanceof PostgresStore) await store.close();
  });

  return Object.assign(app, { services });
}
