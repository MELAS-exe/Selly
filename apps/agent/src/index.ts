import { buildApp } from './app';
import { checkSecrets } from './config';
import { PostgresStore } from './store/postgres';

const secretProblems = checkSecrets();
if (secretProblems.length > 0) {
  console.error(`agent: refusing to start in production: ${secretProblems.join('; ')}`);
  process.exit(1);
}

const app = buildApp();
const { config, store, llm } = app.services;

async function main() {
  if (store instanceof PostgresStore) {
    try {
      await store.checkSchema();
    } catch (err) {
      app.log.error(
        { err },
        'Schema "agent" is missing. Run `pnpm --filter @selly/db db:migrate`, or set AGENT_STORE=memory.',
      );
      process.exit(1);
    }
  }
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(
    {
      store: store instanceof PostgresStore ? 'postgres' : 'memory',
      core: config.coreUrl || 'fake (in memory)',
      llm: llm.name,
    },
    'agent ready',
  );
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
