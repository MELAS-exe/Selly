import Fastify from 'fastify';
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

export function buildApp() {
  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.authorization', 'req.headers.cookie'] },
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'core' }));

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
