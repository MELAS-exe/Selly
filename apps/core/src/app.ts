import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { Context } from './context';
import { AppError, registerErrorHandling } from './errors';
import { authModule } from './modules/auth';
import { catalogModule } from './modules/catalog';
import { eventsModule } from './modules/events';
import { inventoryModule } from './modules/inventory';
import { mediaModule } from './modules/media';
import { ordersModule } from './modules/orders';
import { paymentsModule } from './modules/payments';
import { ratesModule } from './modules/rates';
import { subscriptionsModule } from './modules/subscriptions';
import { vendorsModule } from './modules/vendors';
import { walletModule } from './modules/wallet';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function buildApp(ctx: Context) {
  const app = Fastify({
    logger:
      ctx.config.NODE_ENV === 'test'
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.idempotency-key',
            ],
          },
    requestIdHeader: 'x-request-id',
    // The number of proxies in front of core (the web app, then a CDN). Trusting more lets a client fake its IP.
    trustProxy: (_address: string, hop: number) => hop < ctx.config.TRUST_PROXY,
  });
  app.decorate('ctx', ctx);
  // Many clients send Content-Type: application/json on every request, also without a body (logout, deletes).
  // An empty body is "no body", not an error; anything else must be valid JSON.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError('VALIDATION_FAILED', 'The body is not valid JSON.'), undefined);
    }
  });
  app.register(cookie);
  // Opt-in per route (config.rateLimit); answers in the same problem format as every other error.
  app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) =>
      new AppError(
        'RATE_LIMITED',
        `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        {
          headers: { 'Retry-After': String(Math.ceil(context.ttl / 1000)) },
        },
        'Too many requests',
      ),
  });
  registerErrorHandling(app, ctx.config.APP_BASE_URL);

  app.get('/healthz', async () => ({ status: 'ok', service: 'core' }));

  // /internal/* is for the agent only and is never routed from the internet (architecture.md section 11.1).
  // This check is the second lock. Scopes per endpoint come with the service-token table.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/internal/')) return;
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token || !safeEqual(token, ctx.config.SERVICE_TOKEN_AGENT)) {
      throw new AppError('UNAUTHORIZED', 'A valid service token is required.');
    }
  });

  app.register(authModule);
  app.register(vendorsModule);
  app.register(walletModule);
  app.register(catalogModule);
  app.register(inventoryModule);
  app.register(ordersModule);
  app.register(paymentsModule);
  app.register(ratesModule);
  app.register(subscriptionsModule);
  app.register(mediaModule);
  app.register(eventsModule);

  return app;
}
