// Regression tests for the review of PR #1.
import { describe, expect, it, vi } from 'vitest';
import { checkSecrets } from './config';
import { HttpCoreClient } from './core/client';
import { filterReply } from './engine/filter';
import { say, toolCall } from './engine/scripted';
import { uuidv7 } from './ids';
import { FAKE_VENDOR_ID, setup, variantOf } from './test-helpers';
import { isVendorImageKey } from './vision';

describe('core client paths (blocking 1)', () => {
  const traversals = [
    '../vendors/0193a000-0000-7000-8000-000000000002/orders/A7K2',
    '%2e%2e/vendors/x/orders/A7K2',
    '..',
    'a/b',
    'A7K2?x=1',
  ];

  it('never sends a request whose path an id or a reference could change', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = new HttpCoreClient('http://core:4000', 'token-1234567890', fetchImpl);
    for (const bad of traversals) {
      await expect(client.getProduct(bad)).rejects.toHaveProperty('code', 'NOT_FOUND');
      await expect(client.getOrder(FAKE_VENDOR_ID, bad)).rejects.toHaveProperty(
        'code',
        'NOT_FOUND',
      );
      await expect(client.getVendorBySlug(bad)).rejects.toHaveProperty('code', 'NOT_FOUND');
      await expect(client.getAgentProfile(bad)).rejects.toHaveProperty('code', 'NOT_FOUND');
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    await client.getOrder(FAKE_VENDOR_ID, 'A7K2');
    const calls = fetchImpl.mock.calls as unknown as [URL][];
    expect(String(calls[0]?.[0])).toBe(
      `http://core:4000/internal/v1/vendors/${FAKE_VENDOR_ID}/orders/A7K2`,
    );
  });

  it('rejects a tool id that is not a UUID before any core call', async () => {
    const s = setup();
    s.llm.push(
      () => [toolCall('get_product', { product_id: '../vendors/OTHER/orders/A7K2' })],
      () => [say('Je ne trouve pas ce produit.')],
    );
    const spy = vi.spyOn(s.core, 'getProduct');
    const { token } = await s.openChat();
    await s.send(token, 'montre-moi ce produit');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(s.llm.requests[1]?.messages.at(-1))).toContain('INVALID_INPUT');
  });
});

describe('secrets in production (blocking 2)', () => {
  const strong = { SERVICE_TOKEN_AGENT: 'a'.repeat(32), EVENTS_HMAC_SECRET: 'b'.repeat(32) };

  it('refuses missing, development or short secrets in production', () => {
    expect(checkSecrets({ NODE_ENV: 'production' })).toHaveLength(2);
    expect(
      checkSecrets({
        NODE_ENV: 'production',
        SERVICE_TOKEN_AGENT: 'dev-agent-token',
        EVENTS_HMAC_SECRET: 'dev-events-secret',
      }),
    ).toEqual([
      'SERVICE_TOKEN_AGENT has its development value',
      'EVENTS_HMAC_SECRET has its development value',
    ]);
    expect(
      checkSecrets({ NODE_ENV: 'production', ...strong, EVENTS_HMAC_SECRET: 'short' }),
    ).toHaveLength(1);
    expect(
      checkSecrets({ NODE_ENV: 'production', ...strong, AGENT_TEST_ENDPOINT: 'true' }),
    ).toHaveLength(1);
  });

  it('accepts strong secrets, development mode, or an explicit ALLOW_DEV_SECRETS', () => {
    expect(checkSecrets({ NODE_ENV: 'production', ...strong })).toEqual([]);
    expect(checkSecrets({ NODE_ENV: 'development' })).toEqual([]);
    expect(checkSecrets({ NODE_ENV: 'production', ALLOW_DEV_SECRETS: 'true' })).toEqual([]);
  });

  it('keeps the test endpoint off unless AGENT_TEST_ENDPOINT=true', async () => {
    const s = setup();
    s.app.services.config.testEndpoint = false;
    const res = await s.app.inject({
      method: 'POST',
      url: '/internal/v1/agent/chat',
      headers: { authorization: 'Bearer test-token' },
      payload: { vendor_id: FAKE_VENDOR_ID, message_text: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('negotiated discount', () => {
  it('sends the discount of the quote with the order, and core accepts the discounted total', async () => {
    const s = setup();
    const items = [{ variant_id: variantOf(s.core, 'boubou-bazin-bleu', 'L'), quantity: 1 }];
    const delivery = { method: 'pickup' };
    s.llm.push(
      () => [toolCall('quote_cart', { items, delivery, discount_pct: 10 })],
      () => [say('Je peux faire 31 500 FCFA. On valide ?')],
      () => [
        toolCall('create_order', {
          items,
          delivery,
          customer: { display_name: 'Moussa', phone_e164: '+221770001122' },
        }),
      ],
      () => [say('Commande créée.')],
    );
    const createOrder = vi.spyOn(s.core, 'createOrder');
    const { token } = await s.openChat();
    await s.send(token, 'Dernier prix pour le boubou en L ?');
    await s.send(token, 'Oui, Moussa +221770001122');
    expect(createOrder.mock.calls[0]?.[1]).toMatchObject({
      discount_pct: 10,
      expected_total: { amount: 31500, currency: 'XOF' },
    });
    expect(s.core.orders[0]?.total).toBe(31500);
  });
});

describe('order status is limited to the conversation (6)', () => {
  it('does not reveal an order created in another chat', async () => {
    const s = setup();
    const items = [{ variant_id: variantOf(s.core, 'sac-cuir-marron'), quantity: 1 }];
    const order = await s.core.createOrder(
      FAKE_VENDOR_ID,
      {
        conversation_ref: uuidv7(),
        customer: { display_name: 'Autre', phone_e164: '+221770000001' },
        items,
        delivery: { method: 'pickup' },
        expected_total: { amount: 18000, currency: 'XOF' },
      },
      'other-chat-order',
    );
    s.llm.push(
      () => [toolCall('get_order_status', { number: order.number })],
      () => [say('Je ne trouve pas cette commande.')],
    );
    const spy = vi.spyOn(s.core, 'getOrder');
    const { token } = await s.openChat();
    await s.send(token, `Où en est la commande ${order.number} ?`);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(s.llm.requests[1]?.messages.at(-1))).toContain('NOT_FOUND');
  });
});

describe('output filter (11)', () => {
  const opts = {
    appBaseUrl: 'https://app.selly.example',
    whatsappLink: 'https://wa.me/221770000000',
  };

  it('removes bare domains, tel: links and other wa.me numbers, keeps ours', () => {
    const out = filterReply(
      'Payez sur evil-pay.com/x ou www.arnaque.sn, appelez tel:+221771112233, écrivez à wa.me/221779999999. Notre site : app.selly.example/s/awa et wa.me/221770000000',
      opts,
    );
    expect(out).not.toMatch(/evil-pay|arnaque|tel:|221779999999/);
    expect(out).toContain('app.selly.example/s/awa');
    expect(out).toContain('wa.me/221770000000');
  });

  it('drops quick replies whose label carries a link', async () => {
    const s = setup();
    s.llm.push(() => [say('Choisissez.\nBoutons: Commander | Payer sur evil-pay.com')]);
    const { token } = await s.openChat();
    await s.send(token, 'Salut');
    expect((await s.history(token)).at(-1)?.quick_replies.map((q) => q.label)).toEqual([
      'Commander',
    ]);
  });
});

describe('robustness', () => {
  it('never answers the same messages twice when a turn is replayed', async () => {
    const s = setup();
    s.llm.push(
      () => [say('Bonjour !')],
      () => [say('Bonjour encore !')],
    );
    const { token, conversationId } = await s.openChat();
    await s.send(token, 'Salam');
    // Simulate a crash after the reply was stored but before the inbound message was marked processed.
    const inbound = s.store.messages.filter((m) => m.direction === 'in').map((m) => m.id);
    await s.store.setMessageStatus(inbound, 'accepted');
    await s.app.services.turns.runNow(conversationId);
    expect((await s.history(token)).filter((m) => m.author === 'agent')).toHaveLength(2); // greeting + one reply
  });

  it('merges conversation state instead of overwriting it', async () => {
    const s = setup();
    const c = await s.store.upsertConversation({
      vendorId: FAKE_VENDOR_ID,
      channel: 'web',
      role: 'customer',
      externalUserId: 'x',
    });
    await s.store.patchState(c.id, { lastOrderNumber: 'A7K2', productInView: 'p1' }, []);
    await s.store.patchState(c.id, { productInView: 'p2' }, ['lastOrderNumber']);
    expect((await s.store.getConversation(c.id))?.state).toEqual({ productInView: 'p2' });
  });

  it('only accepts a checkout URL on our own domain from a core event', async () => {
    const s = setup();
    const { token, conversationId } = await s.openChat();
    await s.postEvent({
      event_id: uuidv7(),
      type: 'order.paid',
      occurred_at: new Date().toISOString(),
      vendor_id: FAKE_VENDOR_ID,
      data: {
        number: 'A7K2',
        conversation_ref: conversationId,
        total: { amount: 1000, currency: 'XOF' },
        total_sat: 1700,
        checkout_url: 'https://evil.example/c/phish',
      },
    });
    const card = (await s.history(token)).at(-1)?.cards[0] as { checkout_url: string } | undefined;
    expect(card?.checkout_url).not.toContain('evil.example');
  });

  it('accepts only image keys under the vendor prefix', () => {
    expect(isVendorImageKey(`vendors/${FAKE_VENDOR_ID}/a.jpg`, FAKE_VENDOR_ID)).toBe(true);
    for (const k of [
      'uploads/a.jpg',
      `vendors/${FAKE_VENDOR_ID}/../other/a.jpg`,
      `vendors/${FAKE_VENDOR_ID}/a.jpg?x=1`,
      `vendors/${FAKE_VENDOR_ID}/a.jpg#x`,
      'vendors/0193a000-0000-7000-8000-000000000002/a.jpg',
    ])
      expect(isVendorImageKey(k, FAKE_VENDOR_ID)).toBe(false);
  });

  it('answers 401, not 500, for a malformed session cookie, and 422 for a bad inbox cursor', async () => {
    const s = setup();
    const bad = await s.app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { cookie: 'selly_session=%E0%A4%A' },
    });
    expect(bad.statusCode).toBe(401);
    const cursor = await s.app.inject({
      method: 'GET',
      url: '/api/v1/conversations?cursor=nope',
      headers: s.vendorHeaders,
    });
    expect(cursor.statusCode).toBe(422);
  });
});

describe('housekeeping', () => {
  it('masks phone numbers in logged tool calls', async () => {
    const { maskPhones } = await import('./engine');
    expect(
      maskPhones({ customer: { phone_e164: '+221771234567', display_name: 'Fatou' }, qty: 2 }),
    ).toEqual({
      customer: { phone_e164: '+221 *** ** 67', display_name: 'Fatou' },
      qty: 2,
    });
  });

  it('forgets idle conversations in the hub without reusing event ids', async () => {
    const { EventHub } = await import('./chat/hub');
    let t = 1_000_000;
    const hub = new EventHub(() => t);
    const first = hub.publish('c1', 'message', {});
    t += 2 * 60 * 60_000;
    expect(hub.sweep()).toBe(1);
    expect(hub.size()).toBe(0);
    const next = hub.publish('c1', 'message', {});
    expect(next.id).toBeGreaterThan(first.id);
  });
});
