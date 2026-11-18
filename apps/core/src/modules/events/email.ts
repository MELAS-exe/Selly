// Alerts by email (architecture.md 3.4): the third channel next to Web Push and Nostr direct messages, for vendors
// who live in their inbox. The vendor gives an address and confirms it with a code sent there; alerts only go to a
// confirmed address, so nobody can point Selly's mail at someone else.
//
// Providers: none (default: no email at all), log (development: the message goes to core's log), resend (Resend's
// HTTP API, RESEND_API_KEY and EMAIL_FROM). Another provider is one more `send`.
import { createHash, randomInt } from 'node:crypto';
import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import type { Config } from '../../config';
import type { Context, Logger } from '../../context';
import { AppError } from '../../errors';
import { alertSettings, type Vendor } from '../catalog/store';
import type { Alert } from './alerts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function emailSender(
  config: Pick<Config, 'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM'>,
  log: Logger,
): EmailSender | null {
  if (config.EMAIL_PROVIDER === 'log')
    return {
      async send(m) {
        log.info({ to: m.to, subject: m.subject, text: m.text }, 'email (log provider, not sent)');
      },
    };
  if (config.EMAIL_PROVIDER === 'resend') {
    if (!config.RESEND_API_KEY) return null;
    return {
      async send(m) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.RESEND_API_KEY}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from: config.EMAIL_FROM, ...m }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`resend answered ${res.status}`);
      },
    };
  }
  return null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A plain, readable email in Selly's colours: what happened, and one link to act on it. */
export function alertEmail(to: string, alert: Alert): EmailMessage {
  return {
    to,
    subject: alert.title,
    text: `${alert.body}\n\n${alert.url}\n\nSelly : réglez vos alertes dans Réglages.`,
    html: `<div style="font-family:Arial,sans-serif;color:#173b32;max-width:520px">
<h1 style="font-size:20px;font-weight:600">${escape(alert.title)}</h1>
<p style="font-size:15px;line-height:1.5">${escape(alert.body)}</p>
<p><a href="${escape(alert.url)}" style="display:inline-block;background:#173b32;color:#f6f4f0;padding:12px 18px;text-decoration:none">Ouvrir le tableau de bord</a></p>
<p style="font-size:12px;color:#5c6f68">Selly · réglez vos alertes dans Réglages.</p>
</div>`,
  };
}

// ---------------------------------------------------------------------------------------------- the address

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

interface RawEmail {
  email?: { address: string; verified_at: string } | null;
  email_pending?: {
    address: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
  } | null;
}

const hashCode = (vendorId: string, code: string) =>
  createHash('sha256').update(`${vendorId}:${code}`).digest('hex');

async function saveAlerts(ctx: Context, v: Vendor, patch: RawEmail) {
  const settings = v.settings as { alerts?: Record<string, unknown> };
  const alerts = { ...(settings.alerts ?? {}), ...patch };
  const [updated] = await ctx.db
    .update(core.vendors)
    .set({ settings: { ...settings, alerts }, updatedAt: ctx.now() })
    .where(eq(core.vendors.id, v.id))
    .returning();
  return updated as Vendor;
}

/** Sends a 6-digit code to the address; it becomes the alert address once the code comes back (verifyEmail). */
export async function requestEmail(ctx: Context, v: Vendor, rawAddress: string) {
  const address = rawAddress.trim().toLowerCase();
  if (!EMAIL.test(address))
    throw new AppError('VALIDATION_FAILED', 'Cette adresse e-mail n’est pas valide.', {
      errors: [{ field: 'address', message: 'Invalid' }],
    });
  if (!ctx.email)
    throw new AppError(
      'VALIDATION_FAILED',
      'L’envoi d’e-mails n’est pas configuré sur ce serveur.',
    );
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const updated = await saveAlerts(ctx, v, {
    email_pending: {
      address,
      code_hash: hashCode(v.id, code),
      expires_at: new Date(ctx.now().getTime() + CODE_TTL_MS).toISOString(),
      attempts: 0,
    },
  });
  await ctx.email.send({
    to: address,
    subject: `Votre code Selly : ${code}`,
    text: `Votre code pour recevoir les alertes de ${v.displayName} : ${code}\nIl expire dans 15 minutes. Si vous n’avez rien demandé, ignorez cet e-mail.`,
    html: `<div style="font-family:Arial,sans-serif;color:#173b32"><p>Votre code pour recevoir les alertes de ${escape(v.displayName)} :</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p style="font-size:13px;color:#5c6f68">Il expire dans 15 minutes. Si vous n’avez rien demandé, ignorez cet e-mail.</p></div>`,
  });
  return alertSettings(updated);
}

export async function verifyEmail(ctx: Context, v: Vendor, code: string) {
  const pending = (v.settings as { alerts?: RawEmail }).alerts?.email_pending;
  const wrong = (detail: string) =>
    new AppError('VALIDATION_FAILED', detail, { errors: [{ field: 'code', message: detail }] });
  if (!pending) throw wrong('Demandez d’abord un code.');
  if (Date.parse(pending.expires_at) < ctx.now().getTime() || pending.attempts >= MAX_ATTEMPTS) {
    await saveAlerts(ctx, v, { email_pending: null });
    throw wrong('Ce code a expiré. Demandez-en un nouveau.');
  }
  if (hashCode(v.id, code.trim()) !== pending.code_hash) {
    await saveAlerts(ctx, v, { email_pending: { ...pending, attempts: pending.attempts + 1 } });
    throw wrong('Ce code n’est pas le bon.');
  }
  const updated = await saveAlerts(ctx, v, {
    email: { address: pending.address, verified_at: ctx.now().toISOString() },
    email_pending: null,
  });
  return alertSettings(updated);
}

export async function removeEmail(ctx: Context, v: Vendor) {
  return alertSettings(await saveAlerts(ctx, v, { email: null, email_pending: null }));
}
