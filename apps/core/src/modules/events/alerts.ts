// Alerts outside the dashboard (architecture.md sections 3.4, 3.7 and 6.6): Web Push to the vendor's installed
// PWA, an email to a confirmed address (email.ts), and a Nostr direct message (NIP-17) for plans that include it. The dashboard stream already shows every
// notification; these reach a vendor who is not looking.
//
// The worker runs on the job leader. It claims each notification before sending (delivered_at), so a restart never
// sends one twice; a lost alert is acceptable, a duplicate one is noise. Only some types are worth an alert.
import { core } from '@selly/db';
import { and, asc, eq, isNull } from '@selly/db/orm';
import * as nip17 from 'nostr-tools/nip17';
import { SimplePool } from 'nostr-tools/pool';
import { sendNotification } from 'web-push';
import type { Context } from '../../context';
import { alertSettings } from '../catalog/store';
import { currentSubscription } from '../subscriptions/service';
import { alertEmail, type EmailSender } from './email';

const { vendorNotifications: vn, pushSubscriptions: ps, vendors } = core;
type Notification = typeof vn.$inferSelect;

export interface Alert {
  title: string;
  body: string;
  /** Where the dashboard opens when the vendor taps it. */
  url: string;
  tag: string;
}

const xof = (n: unknown) =>
  `${Number(n ?? 0)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, ' ')} FCFA`;

/** The alert for a notification, or null when this type is only shown on the dashboard. */
export function alertFor(
  n: Pick<Notification, 'type' | 'data' | 'id'>,
  appBaseUrl: string,
): Alert | null {
  const d = n.data as Record<string, unknown>;
  const app = `${appBaseUrl}/app`;
  switch (n.type) {
    case 'order.paid': {
      const total = d.total as { amount?: number; currency?: string } | undefined;
      const amount = total?.currency === 'SAT' ? `${total.amount} sats` : xof(total?.amount);
      return {
        title: `Commande ${d.number} payée`,
        body: `${amount} reçus sur votre portefeuille. Préparez la livraison.`,
        url: `${app}/commandes/${d.order_id}`,
        tag: `order-${d.order_id}`,
      };
    }
    case 'conversation.handoff':
      return {
        title: 'Un client veut vous parler',
        body: String(d.title ?? d.summary ?? 'Ouvrez la discussion pour répondre.'),
        url: `${app}/discussions/${d.conversation_id ?? ''}`,
        tag: `chat-${d.conversation_id ?? n.id}`,
      };
    case 'conversation.new':
      return {
        title: 'Nouveau message',
        body: String(d.title ?? 'Un client vous a écrit.'),
        url: `${app}/discussions/${d.conversation_id ?? ''}`,
        tag: `chat-${d.conversation_id ?? n.id}`,
      };
    case 'wallet.degraded':
      return {
        title: 'Votre portefeuille ne répond pas',
        body: 'Les clients ne peuvent pas payer tant qu’il est hors ligne. Ouvrez votre application de portefeuille.',
        url: `${app}/portefeuille`,
        tag: 'wallet',
      };
    case 'subscription.updated': {
      const sub = `${app}/abonnement`;
      if (d.reason === 'reminder')
        return {
          title:
            d.days_left === 1
              ? 'Votre abonnement se termine demain'
              : `Votre abonnement se termine dans ${d.days_left} jours`,
          body: 'Renouvelez en quelques secondes avec votre portefeuille.',
          url: sub,
          tag: 'subscription',
        };
      if (d.reason === 'status' && d.status === 'grace')
        return {
          title: 'Abonnement expiré',
          body: 'Votre boutique reste ouverte 7 jours. Renouvelez pour ne rien perdre.',
          url: sub,
          tag: 'subscription',
        };
      if (d.reason === 'status' && d.status === 'suspended')
        return {
          title: 'Boutique fermée',
          body: 'Les clients ne peuvent plus commander. Renouvelez pour la rouvrir.',
          url: sub,
          tag: 'subscription',
        };
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------- senders

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  /** `gone`: the browser unsubscribed (404 or 410); the subscription is dropped. */
  send(target: PushTarget, alert: Alert): Promise<{ gone: boolean }>;
}

export interface DmSender {
  send(recipientPubkey: string, text: string): Promise<void>;
}

export function webPushSender(config: {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) return null;
  const vapid = {
    subject: config.VAPID_SUBJECT,
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
  };
  return {
    async send(target, alert) {
      try {
        await sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(alert),
          { vapidDetails: vapid, TTL: 24 * 3600, urgency: 'high', timeout: 10_000 },
        );
        return { gone: false };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return { gone: true };
        throw err;
      }
    },
  };
}

/** NIP-17 private direct messages from the platform's Nostr key, to the relays given. */
export function nostrDmSender(secretKeyHex: string, relays: string[]): DmSender | null {
  if (!/^[0-9a-f]{64}$/.test(secretKeyHex) || relays.length === 0) return null;
  const sk = Buffer.from(secretKeyHex, 'hex');
  const pool = new SimplePool();
  return {
    async send(recipientPubkey, text) {
      const wrap = nip17.wrapEvent(sk, { publicKey: recipientPubkey }, text);
      const results = await Promise.allSettled(pool.publish(relays, wrap));
      if (!results.some((r) => r.status === 'fulfilled'))
        throw new Error('no relay accepted the direct message');
    },
  };
}

export interface AlertSenders {
  push: PushSender | null;
  dm: DmSender | null;
  email?: EmailSender | null;
}

// ---------------------------------------------------------------------------------------------- worker

/** One pass: claim up to 100 notifications, send the ones worth an alert. */
export async function deliverAlerts(ctx: Context, senders: AlertSenders) {
  const now = ctx.now();
  const rows = await ctx.db
    .select()
    .from(vn)
    .where(isNull(vn.deliveredAt))
    .orderBy(asc(vn.id))
    .limit(100);
  let pushed = 0;
  let dms = 0;
  let emails = 0;
  for (const n of rows) {
    const claimed = await ctx.db
      .update(vn)
      .set({ deliveredAt: now })
      .where(and(eq(vn.id, n.id), isNull(vn.deliveredAt)))
      .returning({ id: vn.id });
    if (claimed.length === 0) continue;
    const alert = alertFor(n, ctx.config.APP_BASE_URL);
    if (!alert) continue;

    const [v] = await ctx.db.select().from(vendors).where(eq(vendors.id, n.vendorId));
    if (!v) continue;
    const settings = alertSettings(v);

    if (senders.push && settings.web_push) {
      const targets = await ctx.db
        .select()
        .from(ps)
        .where(and(eq(ps.vendorId, n.vendorId), isNull(ps.revokedAt)));
      for (const t of targets) {
        try {
          const { gone } = await senders.push.send(t, alert);
          if (gone) {
            await ctx.db.update(ps).set({ revokedAt: now }).where(eq(ps.id, t.id));
          } else {
            pushed++;
            if (t.lastError)
              await ctx.db.update(ps).set({ lastError: null }).where(eq(ps.id, t.id));
          }
        } catch (err) {
          await ctx.db
            .update(ps)
            .set({ lastError: String(err).slice(0, 300) })
            .where(eq(ps.id, t.id));
        }
      }
    }

    if (senders.email && settings.email.enabled && settings.email.address) {
      try {
        await senders.email.send(alertEmail(settings.email.address, alert));
        emails++;
      } catch (err) {
        ctx.log.warn({ err: String(err), vendorId: n.vendorId }, 'email alert not sent');
      }
    }

    if (senders.dm && settings.nostr_dm.enabled && settings.nostr_dm.pubkey) {
      // The plan must still include it: a shop that moved down to Starter stops getting them.
      const sub = await currentSubscription(ctx, n.vendorId);
      if (sub?.limits.nostr_dm_alerts) {
        try {
          await senders.dm.send(
            settings.nostr_dm.pubkey,
            `${alert.title}\n${alert.body}\n${alert.url}`,
          );
          dms++;
        } catch (err) {
          ctx.log.warn({ err: String(err), vendorId: n.vendorId }, 'Nostr alert not sent');
        }
      }
    }
  }
  return { checked: rows.length, pushed, dms, emails };
}
