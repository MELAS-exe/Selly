// Alerts outside the dashboard: which notifications become a Web Push or a Nostr direct message, sent once, to
// whom; dead browsers dropped; the direct message is a real NIP-17 gift wrap.
import { randomBytes } from 'node:crypto';
import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import { TestRelay } from '@selly/nwc/testkit';
import * as nip17 from 'nostr-tools/nip17';
import { SimplePool } from 'nostr-tools/pool';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Alert,
  type AlertSenders,
  deliverAlerts,
  nostrDmSender,
  type PushTarget,
  webPushSender,
} from './modules/events/alerts';
import { notifyVendor } from './modules/events/notifications';
import { createShop, createTestApp, type TestApp } from './testing';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
}, 60_000);
afterAll(() => t.close());

function fakeSenders(gone: Set<string> = new Set()) {
  const pushes: { endpoint: string; alert: Alert }[] = [];
  const dms: { to: string; text: string }[] = [];
  const senders: AlertSenders = {
    push: {
      send: async (target: PushTarget, alert: Alert) => {
        if (gone.has(target.endpoint)) return { gone: true };
        pushes.push({ endpoint: target.endpoint, alert });
        return { gone: false };
      },
    },
    dm: {
      send: async (to, text) => {
        dms.push({ to, text });
      },
    },
  };
  return { senders, pushes, dms };
}

async function browser(vendorId: string, name: string) {
  const endpoint = `https://push.example/${name}-${randomBytes(4).toString('hex')}`;
  await t.db.insert(core.pushSubscriptions).values({ vendorId, endpoint, p256dh: 'k', auth: 'a' });
  return endpoint;
}

const notify = (
  vendorId: string,
  type: Parameters<typeof notifyVendor>[1]['type'],
  data: Record<string, unknown>,
) => notifyVendor(t.db, { vendorId, type, data, now: t.clock.now() });

describe('alert worker', () => {
  it('pushes a paid order to every browser of the vendor, once, and drops a browser that unsubscribed', async () => {
    const s = await createShop(t.db, 'alert-a');
    const phone = await browser(s.vendorId, 'phone');
    const old = await browser(s.vendorId, 'old');
    const { senders, pushes } = fakeSenders(new Set([old]));

    await notify(s.vendorId, 'order.paid', {
      order_id: 'o1',
      number: 'A7K2',
      total: { amount: 16000, currency: 'XOF' },
    });
    await notify(s.vendorId, 'usage.warning', { metric: 'agent_turns', percent: 80 });
    await deliverAlerts(t.ctx, senders);

    expect(pushes).toEqual([
      {
        endpoint: phone,
        alert: {
          title: 'Commande A7K2 payée',
          body: '16 000 FCFA reçus sur votre portefeuille. Préparez la livraison.',
          url: 'http://localhost:3000/app/commandes/o1',
          tag: 'order-o1',
        },
      },
    ]);
    const [gone] = await t.db
      .select()
      .from(core.pushSubscriptions)
      .where(eq(core.pushSubscriptions.endpoint, old));
    expect(gone?.revokedAt).not.toBeNull();

    // Claimed: a second pass sends nothing.
    await deliverAlerts(t.ctx, senders);
    expect(pushes).toHaveLength(1);
  });

  it('respects the vendor’s choice, and sends Nostr direct messages only on plans that include them', async () => {
    const pro = await createShop(t.db, 'alert-pro', { plan: 'pro' });
    const starter = await createShop(t.db, 'alert-starter', { plan: 'starter' });
    const pubkey = getPublicKey(generateSecretKey());
    const alerts = { web_push: false, nostr_dm: { enabled: true, pubkey } };
    for (const v of [pro, starter])
      await t.db
        .update(core.vendors)
        .set({ settings: { pricing_currency: 'XOF', alerts } })
        .where(eq(core.vendors.id, v.vendorId));
    await browser(pro.vendorId, 'pro-phone');
    const { senders, pushes, dms } = fakeSenders();

    for (const v of [pro, starter])
      await notify(v.vendorId, 'subscription.updated', { reason: 'reminder', days_left: 3 });
    await deliverAlerts(t.ctx, senders);

    expect(pushes).toEqual([]); // web_push off
    expect(dms).toEqual([
      {
        to: pubkey,
        text: 'Votre abonnement se termine dans 3 jours\nRenouvelez en quelques secondes avec votre portefeuille.\nhttp://localhost:3000/app/abonnement',
      },
    ]);
  });

  it('is off without VAPID keys or a platform Nostr key', () => {
    expect(
      webPushSender({ VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: 'mailto:x@y.z' }),
    ).toBeNull();
    expect(nostrDmSender('', ['wss://relay.example'])).toBeNull();
  });
});

describe('Nostr direct message', () => {
  it('is a NIP-17 gift wrap that only the vendor can open', async () => {
    const relay = await TestRelay.start();
    try {
      const platform = randomBytes(32).toString('hex');
      const vendorSk = generateSecretKey();
      const dm = nostrDmSender(platform, [relay.url]);
      await dm?.send(getPublicKey(vendorSk), 'Commande A7K2 payée');

      const pool = new SimplePool();
      const events = await pool.querySync([relay.url], {
        kinds: [1059],
        '#p': [getPublicKey(vendorSk)],
      });
      pool.destroy();
      expect(events).toHaveLength(1);
      const rumor = nip17.unwrapEvent(
        events[0] as Parameters<typeof nip17.unwrapEvent>[0],
        vendorSk,
      );
      expect(rumor.content).toBe('Commande A7K2 payée');
      expect(rumor.pubkey).toBe(getPublicKey(Buffer.from(platform, 'hex')));
    } finally {
      await relay.stop();
    }
  });
});

describe('alerts by email', () => {
  it('confirms the address with a code, then sends alerts there', async () => {
    const s = await createShop(t.db, 'alerts-email');
    const [v] = await t.db.select().from(core.vendors).where(eq(core.vendors.id, s.vendorId));
    const { requestEmail, verifyEmail } = await import('./modules/events/email');
    await requestEmail(t.ctx, v as never, 'Awa@Example.com');
    const code = /(\d{6})/.exec(t.emails.at(-1)?.subject ?? '')?.[1] as string;
    expect(t.emails.at(-1)?.to).toBe('awa@example.com');
    const [pending] = await t.db.select().from(core.vendors).where(eq(core.vendors.id, s.vendorId));
    await expect(
      verifyEmail(t.ctx, pending as never, code === '000000' ? '111111' : '000000'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const [again] = await t.db.select().from(core.vendors).where(eq(core.vendors.id, s.vendorId));
    expect((await verifyEmail(t.ctx, again as never, code)).email.address).toBe('awa@example.com');

    await t.db.transaction((tx) =>
      notifyVendor(tx, {
        vendorId: s.vendorId,
        type: 'order.paid',
        data: { number: 'E1', order_id: 'x', total: { amount: 1000, currency: 'XOF' } },
        now: t.clock.now(),
      }),
    );
    const sent: string[] = [];
    await deliverAlerts(t.ctx, {
      push: null,
      dm: null,
      email: { send: async (m) => void sent.push(`${m.to} ${m.subject}`) },
    });
    expect(sent).toContain('awa@example.com Commande E1 payée');
  });
});
