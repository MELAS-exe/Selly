import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { requireVendor } from '../auth/http';
import { requireStepUp } from '../auth/service';
import { linkWallet, liveWallet, unlinkWallet, walletView } from './service';

const linkBody = z.strictObject({
  kind: z.enum(['nwc', 'lightning_address']),
  uri: z.string().max(2000).optional(),
  lud16: z.string().max(200).optional(),
});

// The vendor's receive-only wallet (architecture.md sections 3.6 and 5.3.4). The URI is a credential: it is
// checked, encrypted and never returned. Replacing or unlinking a wallet needs a step-up.
export const walletModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  // Linking calls the wallet several times (get_info, a test invoice): a tighter limit than other routes.
  app.put(
    '/api/v1/vendors/me/wallet',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const s = await requireVendor(ctx(), req);
      const body = linkBody.parse(req.body);
      if (body.kind === 'lightning_address') {
        throw new AppError(
          'VALIDATION_FAILED',
          'Lightning Address wallets are not supported yet. Use an NWC connection.',
          {
            errors: [{ field: 'kind', message: 'Not supported yet' }],
          },
        );
      }
      if (!body.uri)
        throw new AppError('VALIDATION_FAILED', 'uri is required for an NWC wallet.', {
          errors: [{ field: 'uri', message: 'Required' }],
        });
      if (await liveWallet(ctx().db, { owner: 'vendor', vendorId: s.vendorId }))
        requireStepUp(ctx(), s);
      return linkWallet(ctx(), {
        owner: 'vendor',
        vendorId: s.vendorId,
        uri: body.uri,
        actor: `vendor:${s.vendorId}`,
      });
    },
  );

  app.get('/api/v1/vendors/me/wallet', async (req) => {
    const s = await requireVendor(ctx(), req);
    const row = await liveWallet(ctx().db, { owner: 'vendor', vendorId: s.vendorId });
    if (!row) throw new AppError('NOT_FOUND', 'No wallet is linked.');
    return walletView(row);
  });

  app.delete('/api/v1/vendors/me/wallet', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    requireStepUp(ctx(), s);
    await unlinkWallet(ctx(), {
      owner: 'vendor',
      vendorId: s.vendorId,
      actor: `vendor:${s.vendorId}`,
    });
    return reply.code(204).send();
  });
};
