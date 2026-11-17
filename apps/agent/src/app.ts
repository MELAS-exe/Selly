import Fastify from 'fastify';

export function buildApp() {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'agent' }));

  // TODO (Dev 2): chat sessions, messages and SSE (docs/api.json tag "Chat"), the inbox ("Inbox"),
  // the vendor assistant ("Assistant"), and POST /internal/v1/events. See docs/architecture.md sections 3.8, 7.2 and 8.

  return app;
}
