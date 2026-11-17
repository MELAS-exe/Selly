import type { FastifyPluginAsync } from 'fastify';
import { iso } from '../../util';

// BTC/XOF quotes from the median of BTC/EUR sources (architecture.md 3.6, 4.5).
export const ratesModule: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/rates/btc-xof', async (_req, reply) => {
    const q = await app.ctx.rates.current();
    reply.header('Cache-Control', 'public, max-age=30');
    return {
      xof_per_btc: Math.floor(q.xofPerBtcCents / 100),
      xof_per_sat: q.xofPerBtcCents / 1e10,
      source: q.source,
      inputs: q.inputs.map((i) => ({ source: i.source, btc_eur: Number(i.btc_eur_cents) / 100 })),
      quoted_at: iso(q.fetchedAt),
      valid_until: iso(q.validUntil),
    };
  });
};
