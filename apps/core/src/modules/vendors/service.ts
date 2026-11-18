// The vendor's shop: creation after sign-in, profile and settings (architecture.md section 5.2 group D).
import { core } from '@selly/db';
import { and, eq, isNull, sql } from '@selly/db/orm';
import { z } from 'zod';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { iso } from '../../util';
import type { Session } from '../auth/service';
import { alertSettings, type Vendor, vendorSettings } from '../catalog/store';
import { audit } from '../events/outbox';
import { processUpload } from '../media/images';
import { currentSubscription } from '../subscriptions/service';
import { liveWallet } from '../wallet/service';

const { vendors, vendorKeys, vendorSessions, products } = core;

/** Words a shop cannot take as its slug: they name our own pages or would mislead customers. */
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'aide',
  'help',
  'login',
  'selly',
  'support',
  'tarifs',
  'www',
]);
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export async function vendorView(ctx: Context, v: Vendor) {
  const [wallet, sub] = await Promise.all([
    liveWallet(ctx.db, { owner: 'vendor', vendorId: v.id }),
    currentSubscription(ctx, v.id),
  ]);
  const blockers: (
    | 'wallet_missing'
    | 'wallet_degraded'
    | 'subscription_required'
    | 'subscription_suspended'
  )[] = [];
  if (!wallet) blockers.push('wallet_missing');
  else if (wallet.status === 'degraded') blockers.push('wallet_degraded');
  if (!sub) blockers.push('subscription_required');
  else if (sub.status === 'suspended') blockers.push('subscription_suspended');
  const s = vendorSettings(v);
  const raw = v.settings as {
    agent?: { keep_logs?: boolean };
  };
  return {
    id: v.id,
    display_name: v.displayName,
    slug: v.slug,
    contact_whatsapp_e164: v.contactWhatsappE164,
    locale: v.locale,
    status: v.status,
    store_url: `${ctx.config.APP_BASE_URL}/s/${v.slug}`,
    settings: {
      pricing_currency: s.pricingCurrency,
      delivery: s.delivery,
      hours: s.hours,
      policies: s.policies,
      agent: {
        enabled: s.agentEnabled,
        tone: s.tone,
        negotiation: { mode: s.negotiation.mode, max_discount_pct: s.negotiation.maxDiscountPct },
        keep_logs: raw.agent?.keep_logs ?? true,
      },
      branding: {
        logo_key: s.branding.logoKey,
        logo_url: s.branding.logoKey ? `${ctx.config.CDN_BASE_URL}/${s.branding.logoKey}` : null,
        primary_color: s.branding.primaryColor,
        accent_color: s.branding.accentColor,
        banner: s.branding.banner,
      },
      alerts: alertSettings(v),
    },
    live: v.status === 'active' && blockers.length === 0,
    live_blockers: blockers,
    created_at: iso(v.createdAt) as string,
  };
}

export const createBody = z.strictObject({
  display_name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG, 'Use 3 to 40 characters: a-z, 0-9 and hyphens, not at the ends.'),
  contact_whatsapp_e164: z
    .string()
    .regex(E164, 'Use the international format, e.g. +221771234567')
    .optional(),
  locale: z.enum(['fr-SN', 'en', 'wo-SN']).optional(),
});

/** The shop of a signed-in key that has none yet. The signing key becomes its first key. */
export async function createVendor(ctx: Context, s: Session, body: z.infer<typeof createBody>) {
  if (s.vendorId) throw new AppError('VALIDATION_FAILED', 'This session already has a shop.');
  if (RESERVED_SLUGS.has(body.slug)) {
    throw new AppError('VALIDATION_FAILED', `The slug "${body.slug}" is reserved.`, {
      errors: [{ field: 'slug', message: 'Reserved' }],
    });
  }
  const now = ctx.now();
  const vendor = await ctx.db.transaction(async (tx) => {
    const [owned] = await tx.select().from(vendorKeys).where(eq(vendorKeys.pubkey, s.pubkey));
    if (owned)
      throw new AppError('VALIDATION_FAILED', 'This key already belongs to a shop. Sign in again.');
    const [taken] = await tx
      .select({ id: vendors.id })
      .from(vendors)
      .where(eq(vendors.slug, body.slug));
    if (taken) {
      throw new AppError('VALIDATION_FAILED', `The slug "${body.slug}" is already used.`, {
        errors: [{ field: 'slug', message: 'Already used' }],
      });
    }
    const [v] = await tx
      .insert(vendors)
      .values({
        displayName: body.display_name,
        slug: body.slug,
        contactWhatsappE164: body.contact_whatsapp_e164 ?? null,
        locale: body.locale ?? 'fr-SN',
        // The agent waits until the shop is live and the vendor switches it on.
        settings: { agent: { enabled: false } },
      })
      .returning();
    const created = v as Vendor;
    await tx
      .insert(vendorKeys)
      .values({ pubkey: s.pubkey, vendorId: created.id, label: 'Première clé', lastUsedAt: now });
    // Every open session of this key now belongs to the shop.
    await tx
      .update(vendorSessions)
      .set({ vendorId: created.id })
      .where(and(eq(vendorSessions.pubkey, s.pubkey), isNull(vendorSessions.vendorId)));
    await audit(tx, {
      actor: `vendor:${created.id}`,
      action: 'vendor.created',
      target: created.id,
      details: { slug: created.slug },
    });
    return created;
  });
  return vendorView(ctx, vendor);
}

const money = z.object({ amount: z.number().int().min(0), currency: z.enum(['XOF', 'SAT']) });
const settingsPatch = z.strictObject({
  pricing_currency: z.enum(['XOF', 'SAT']).optional(),
  delivery: z
    .strictObject({
      zones: z
        .array(
          z.strictObject({
            id: z.string().regex(/^[a-z0-9-]{1,40}$/),
            label: z.string().min(1).max(60),
            fee: money,
          }),
        )
        .max(20)
        .optional(),
      pickup: z
        .strictObject({ available: z.boolean(), address_text: z.string().max(200).nullable() })
        .optional(),
    })
    .optional(),
  hours: z
    .array(
      z.strictObject({
        days: z.string().min(1).max(30),
        open: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
        close: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/),
      }),
    )
    .max(14)
    .optional(),
  policies: z
    .strictObject({
      returns: z.string().max(500).optional(),
      payment: z.string().max(500).optional(),
    })
    .optional(),
  agent: z
    .strictObject({
      enabled: z.boolean().optional(),
      tone: z.enum(['friendly', 'formal']).optional(),
      negotiation: z
        .strictObject({
          mode: z.enum(['fixed', 'allow']),
          max_discount_pct: z.number().int().min(0).max(30),
        })
        .optional(),
      keep_logs: z.boolean().optional(),
    })
    .optional(),
  branding: z
    .strictObject({
      logo_key: z.string().max(200).nullable().optional(),
      primary_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour, e.g. #173B32')
        .optional(),
      accent_color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour, e.g. #8AAE4A')
        .optional(),
      banner: z
        .strictObject({
          text: z.string().trim().max(140),
          href: z.string().url().max(500).nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
  alerts: z
    .strictObject({
      web_push: z.boolean().optional(),
      nostr_dm: z
        .strictObject({
          enabled: z.boolean(),
          pubkey: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .nullable(),
        })
        .optional(),
    })
    .optional(),
});
export const patchBody = z
  .strictObject({
    display_name: z.string().trim().min(2).max(60).optional(),
    contact_whatsapp_e164: z.string().regex(E164).nullable().optional(),
    locale: z.enum(['fr-SN', 'en', 'wo-SN']).optional(),
    settings: settingsPatch.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change.');

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** `settings` is merged one level deep (docs/api.json): `{agent: {tone}}` keeps the other agent settings. */
export function mergeSettings(old: Record<string, unknown>, patch: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...old };
  for (const [k, v] of Object.entries(patch))
    out[k] = isObj(old[k]) && isObj(v) ? { ...old[k], ...v } : v;
  return out;
}

export async function patchVendor(ctx: Context, v: Vendor, body: z.infer<typeof patchBody>) {
  // A new logo upload is processed (resized, re-encoded, EXIF dropped) before anything is stored, like a product
  // image: a bad photo must change nothing. Only a freshly uploaded key is processed; a key already on the vendor
  // (unchanged) or null (removed) passes straight through.
  const currentLogoKey = vendorSettings(v).branding.logoKey;
  let patchedSettings = body.settings;
  if (
    patchedSettings?.branding &&
    'logo_key' in patchedSettings.branding &&
    patchedSettings.branding.logo_key &&
    patchedSettings.branding.logo_key !== currentLogoKey
  ) {
    const prepared = await processUpload(ctx.media, v.id, patchedSettings.branding.logo_key);
    patchedSettings = {
      ...patchedSettings,
      branding: { ...patchedSettings.branding, logo_key: prepared.storageKey },
    };
  }

  const settings = patchedSettings ? mergeSettings(v.settings, patchedSettings) : v.settings;
  const next = vendorSettings({ ...v, settings });

  if (
    body.settings?.pricing_currency &&
    body.settings.pricing_currency !== vendorSettings(v).pricingCurrency
  ) {
    const [{ n } = { n: 0 }] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.vendorId, v.id));
    if (n > 0)
      throw new AppError(
        'VALIDATION_FAILED',
        'The pricing currency cannot change once the shop has products.',
      );
  }
  if (next.delivery.zones.some((z) => z.fee.currency !== next.pricingCurrency)) {
    throw new AppError('VALIDATION_FAILED', `Delivery fees must be in ${next.pricingCurrency}.`, {
      errors: [{ field: 'settings.delivery.zones', message: 'Wrong currency' }],
    });
  }
  if (body.settings?.alerts?.nostr_dm?.enabled) {
    const sub = await currentSubscription(ctx, v.id);
    if (!sub?.limits.nostr_dm_alerts)
      throw new AppError(
        'FEATURE_NOT_IN_PLAN',
        'Nostr direct-message alerts need the Pro or Business plan.',
      );
  }

  const [updated] = await ctx.db
    .update(vendors)
    .set({
      ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
      ...(body.contact_whatsapp_e164 !== undefined
        ? { contactWhatsappE164: body.contact_whatsapp_e164 }
        : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      settings,
      updatedAt: ctx.now(),
    })
    .where(eq(vendors.id, v.id))
    .returning();
  // TODO (media): purge the store's CDN URLs once the CDN is configured.
  return vendorView(ctx, updated as Vendor);
}
