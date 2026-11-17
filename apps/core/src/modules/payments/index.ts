import type { FastifyPluginAsync } from 'fastify';

// Order and subscription invoices, settlement, reconciliation (architecture.md 3.6, 7.3).
// The logic lives in service.ts and is driven by the reconciler (src/index.ts), not by HTTP routes: settlement is
// detected by asking the wallet, never by trusting an inbound request.
// TODO (Dev 3): the real NWC gateway behind InvoiceProvider (packages/nwc), and subscription invoices.
export const paymentsModule: FastifyPluginAsync = async (_app) => {};
