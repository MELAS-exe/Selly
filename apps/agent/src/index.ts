import { buildApp } from './app';

const port = Number(process.env.AGENT_PORT ?? 4100);
const app = buildApp();

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
