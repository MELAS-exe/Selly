import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { requireSession, requireVendor } from '../auth/http';
import { findVendorById, findVendorBySlug, storeStatus, vendorSettings } from '../catalog/store';
import { createBody, createVendor, patchBody, patchVendor, vendorView } from './service';

const whatsappLink = (e164: string | null) =>
  e164 ? `https://wa.me/${e164.replace('+', '')}` : null;

// Vendors and shop settings. Internal routes for the agent (architecture.md section 5.2 group G).
export const vendorsModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  // A chat session is opening on a storefront: which vendor, and may the chat answer?
  app.get<{ Params: { slug: string } }>('/internal/v1/stores/:slug/vendor', async (req) => {
    const v = await findVendorBySlug(ctx(), req.params.slug);
    const status = await storeStatus(ctx(), v);
    return {
      vendor_id: v.id,
      slug: v.slug,
      display_name: v.displayName,
      store_status: status,
      chat_enabled: status === 'active' && vendorSettings(v).agentEnabled,
      locale: v.locale,
    };
  });

  // Shop facts for the system prompt. The agent caches this for 60 seconds.
  app.get<{ Params: { id: string } }>('/internal/v1/vendors/:id/agent-profile', async (req) => {
    const v = await findVendorById(ctx(), req.params.id);
    const s = vendorSettings(v);
    return {
      vendor_id: v.id,
      display_name: v.displayName,
      slug: v.slug,
      locale: v.locale,
      pricing_currency: s.pricingCurrency,
      tone: s.tone,
      negotiation: { mode: s.negotiation.mode, max_discount_pct: s.negotiation.maxDiscountPct },
      delivery: s.delivery,
      hours: s.hours,
      policies: s.policies,
      whatsapp_link: whatsappLink(v.contactWhatsappE164),
      store_url: `${ctx().config.APP_BASE_URL}/s/${v.slug}`,
      languages: s.languages,
    };
  });

  // ----------------------------------------------------------------------------------- the vendor's own shop

  app.post('/api/v1/vendors', async (req, reply) => {
    const s = await requireSession(ctx(), req);
    const body = createBody.parse(req.body);
    return reply.code(201).send(await createVendor(ctx(), s, body));
  });

  app.get('/api/v1/vendors/me', async (req) => {
    const s = await requireVendor(ctx(), req);
    return vendorView(ctx(), await findVendorById(ctx(), s.vendorId));
  });

  app.patch('/api/v1/vendors/me', async (req) => {
    const s = await requireVendor(ctx(), req);
    const body = patchBody.parse(req.body);
    const [v] = await ctx().db.select().from(core.vendors).where(eq(core.vendors.id, s.vendorId));
    return patchVendor(ctx(), v as NonNullable<typeof v>, body);
  });
};
