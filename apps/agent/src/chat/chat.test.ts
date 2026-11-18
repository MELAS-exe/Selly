import { describe, expect, it } from 'vitest';
import { ScriptedAsr } from '../asr';
import { say, toolCall } from '../engine/scripted';
import { uuidv7 } from '../ids';
import { FAKE_VENDOR_ID, setup, variantOf } from '../test-helpers';

describe('chat sessions', () => {
  it('opens a session with a disclosure greeting and quick replies', async () => {
    const { openChat } = setup();
    const { res, body } = await openChat();
    expect(res.statusCode).toBe(201);
    expect(body.session_token).toMatch(/^ct_/);
    expect(body.store).toEqual({ slug: 'awa-style', display_name: 'Awa Style' });
    expect(body.disclosure).toContain('Assistant automatique de Awa Style');
    expect(body.features).toEqual({ voice_notes: true });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      author: 'agent',
      author_label: 'Assistant de Awa Style',
      status: 'processed',
    });
    expect(body.messages[0].quick_replies.length).toBeGreaterThan(0);
  });

  it('answers 404 for an unknown store and 403 STORE_PAUSED for a paused one', async () => {
    const { openChat, core } = setup();
    expect((await openChat('nobody-here')).res.statusCode).toBe(404);
    core.storeStatus = 'paused';
    const { res } = await openChat();
    expect(res.statusCode).toBe(403);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json().code).toBe('STORE_PAUSED');
  });

  it('answers 401 CHAT_SESSION_EXPIRED without a valid token', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/messages',
      headers: { authorization: 'Bearer ct_nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('CHAT_SESSION_EXPIRED');
  });
});

describe('a customer turn', () => {
  it('accepts with 202, searches the catalog and replies with a product card', async () => {
    const { openChat, send, history, llm } = setup();
    llm.push(
      () => [toolCall('search_products', { query: 'robe noire', size: '42' })],
      () => [
        say(
          'Oui, la robe wax noire existe en 42, il en reste 2. Elle coûte 15 000 FCFA.\nBoutons: Commander | Autres tailles',
        ),
      ],
    );
    const { token } = await openChat();
    const res = await send(token, 'Robe noire en 42 dispo ?');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      author: 'customer',
      status: 'accepted',
      text: 'Robe noire en 42 dispo ?',
    });

    const msgs = await history(token);
    const reply = msgs.at(-1);
    expect(reply?.author).toBe('agent');
    expect(reply?.text).toBe(
      'Oui, la robe wax noire existe en 42, il en reste 2. Elle coûte 15 000 FCFA.',
    );
    expect(reply?.quick_replies.map((q) => q.label)).toEqual(['Commander', 'Autres tailles']);
    expect(reply?.cards[0]).toMatchObject({
      type: 'product',
      title: 'Robe wax noire',
      price: { amount: 15000, currency: 'XOF' },
    });
    expect(msgs.find((m) => m.author === 'customer')?.status).toBe('processed');

    // The tool result went back to the model, and the customer only had sales tools.
    const second = llm.requests[1];
    expect(JSON.stringify(second?.messages.at(-1))).toContain('variant_id');
    expect(llm.requests[0]?.tools?.map((t) => t.name)).toEqual([
      'search_products',
      'get_product',
      'quote_cart',
      'create_order',
      'get_order_status',
      'get_shop_info',
      'handoff_to_vendor',
    ]);
  });

  it('does not run a second turn for a repeated client_message_id', async () => {
    const { app, openChat, llm } = setup();
    llm.push(() => [say('Bonjour !')]);
    const { token } = await openChat();
    const payload = { client_message_id: 'same-id-123', kind: 'text', text: 'Salam' };
    const headers = { authorization: `Bearer ${token}` };
    const a = await app.inject({ method: 'POST', url: '/api/v1/chat/messages', headers, payload });
    await app.services.turns.idle();
    const b = await app.inject({ method: 'POST', url: '/api/v1/chat/messages', headers, payload });
    await app.services.turns.idle();
    expect(a.json().id).toBe(b.json().id);
    expect(llm.requests).toHaveLength(1);
  });

  it('merges a burst of messages into one turn', async () => {
    const { app, openChat, llm, history } = setup({ mergeWindowMs: 100 });
    llm.push(() => [say('Quelle robe vous intéresse ?')]);
    const { token } = await openChat();
    const headers = { authorization: `Bearer ${token}` };
    for (const text of ['Salam', 'robe bi', '42 ?'])
      await app.inject({
        method: 'POST',
        url: '/api/v1/chat/messages',
        headers,
        payload: { client_message_id: `burst-${text}-0001`, kind: 'text', text },
      });
    await app.services.turns.idle();
    expect(llm.requests).toHaveLength(1);
    const userText = JSON.stringify(llm.requests[0]?.messages);
    expect(userText).toContain('Salam');
    expect(userText).toContain('42 ?');
    expect((await history(token)).filter((m) => m.author === 'agent')).toHaveLength(2);
  });

  it('hands over when the reply says so, even without the handoff tool', async () => {
    const { openChat, send, llm, core, store } = setup();
    llm.push(() => [say("D'accord, je passe la main au vendeur. Il vous répond très vite.")]);
    const { token, conversationId } = await openChat();
    await send(token, 'Je veux parler au vendeur');
    expect((await store.getConversation(conversationId))?.mode).toBe('human');
    expect(core.notifications.at(-1)).toMatchObject({ type: 'conversation.handoff' });
  });

  it('asks an English-speaking customer back in English', async () => {
    const { openChat, send, llm } = setup();
    llm.push(
      () => [say('Hello!')],
      () => [say('Bonjour !')],
    );
    const { token } = await openChat();
    await send(token, 'Do you have the black dress in size 42?');
    expect(llm.requests[0]?.system.dynamic).toContain('réponds-lui en anglais');
    await send(token, 'Vous avez la robe en 40 ?');
    expect(llm.requests[1]?.system.dynamic).not.toContain('anglais');
  });

  it('never lets the model announce an order it did not create', async () => {
    const { openChat, send, history, llm, core } = setup();
    llm.push(
      () => [say('Votre commande a été enregistrée. Numéro de commande : A7K2.')],
      () => [say('Votre commande A7K2 est bien enregistrée.')],
    );
    const { token } = await openChat();
    await send(token, 'Oui je valide, Moussa +221770001122');
    expect(core.orders).toHaveLength(0);
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain('create_order');
    expect((await history(token)).at(-1)?.text).toBe(
      'Je transmets votre message au vendeur, il vous répond très vite.',
    );
    expect(core.notifications.at(-1)?.body).toContain('A7K2');
  });

  it('asks the model to fix a reply with an amount no tool returned, then hands off', async () => {
    const { openChat, send, history, llm, core } = setup();
    llm.push(
      () => [say('Elle coûte 12 000 FCFA.')],
      () => [say('Elle coûte toujours 12 000 FCFA.')],
    );
    const { token, conversationId } = await openChat();
    await send(token, 'Prix de la robe ?');
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain('12000');
    const reply = (await history(token)).at(-1);
    expect(reply?.text).toBe('Je transmets votre message au vendeur, il vous répond très vite.');
    expect(core.notifications.at(-1)).toMatchObject({
      type: 'conversation.handoff',
      conversation_id: conversationId,
    });
  });

  it('quotes, creates the order after a yes, and confirms the payment from core', async () => {
    const { openChat, send, history, llm, core, postEvent } = setup();
    const variant = variantOf(core, 'robe-wax-noire', '42');
    const items = [{ variant_id: variant, quantity: 1 }];
    const delivery = { method: 'delivery', zone_id: 'dakar-plateau' };
    llm.push(
      () => [toolCall('quote_cart', { items, delivery })],
      () => [
        say('Total 16 000 FCFA livraison comprise. Je crée la commande ?\nBoutons: Oui | Non'),
      ],
      () => [
        toolCall('create_order', {
          items,
          delivery,
          customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        }),
      ],
      (req) => {
        const result = JSON.parse(
          (req.messages.at(-1)?.content[0] as { content: string }).content,
        ) as {
          number: string;
          total_sat: number;
        };
        return [
          say(
            `Commande ${result.number} créée : 16 000 FCFA (${result.total_sat} sats). Touchez « Payer ».`,
          ),
        ];
      },
    );
    const { token, conversationId } = await openChat();
    await send(token, 'Je prends la robe noire en 42, livraison au Plateau');
    expect((await history(token)).at(-1)?.text).toContain('16 000 FCFA');
    await send(token, 'Oui, Fatou, +221771234567');

    const msgs = await history(token);
    const card = msgs.at(-1)?.cards.find((c) => c.type === 'order') as
      | { number: string; checkout_url: string }
      | undefined;
    expect(card).toMatchObject({
      type: 'order',
      status: 'pending_payment',
      total: { amount: 16000, currency: 'XOF' },
    });
    expect(card?.checkout_url).toMatch(/^http:\/\/localhost:3000\/c\//);
    expect(core.orders).toHaveLength(1);
    expect(core.orders[0]?.conversationRef).toBe(conversationId);

    core.markPaid(card?.number ?? '');
    const event = {
      event_id: uuidv7(),
      type: 'order.paid',
      occurred_at: new Date().toISOString(),
      vendor_id: FAKE_VENDOR_ID,
      data: {
        number: card?.number,
        conversation_ref: conversationId,
        total: { amount: 16000, currency: 'XOF' },
        total_sat: 27103,
      },
    };
    expect((await postEvent(event)).json()).toEqual({ received: true, duplicate: false });
    expect((await postEvent(event)).json()).toEqual({ received: true, duplicate: true });
    expect((await postEvent(event, 'wrong-secret')).statusCode).toBe(401);

    const system = (await history(token)).filter((m) => m.author === 'system');
    expect(system).toHaveLength(1);
    expect(system[0]?.text).toBe(`Paiement reçu. Commande ${card?.number} confirmée.`);
    expect(system[0]?.cards[0]).toMatchObject({
      type: 'order',
      status: 'paid',
      checkout_url: card?.checkout_url,
    });
  });

  it('refuses create_order without a matching quote', async () => {
    const { openChat, send, llm, core } = setup();
    const items = [{ variant_id: variantOf(core, 'robe-wax-noire', '42'), quantity: 1 }];
    llm.push(
      () => [
        toolCall('create_order', {
          items,
          delivery: { method: 'pickup' },
          customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        }),
      ],
      () => [say('Je calcule d’abord le total.')],
    );
    const { token } = await openChat();
    await send(token, 'Commande vite');
    expect(core.orders).toHaveLength(0);
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain('QUOTE_REQUIRED');
  });

  it('creates the order when the address comes with the « oui », without a second quote', async () => {
    const { openChat, send, llm, core } = setup();
    const items = [{ variant_id: variantOf(core, 'robe-wax-noire', '42'), quantity: 1 }];
    const customer = { display_name: 'Fatou', phone_e164: '+221771234567' };
    llm.push(
      () => [
        toolCall('quote_cart', {
          items,
          delivery: { method: 'delivery', zone_id: 'dakar-plateau' },
        }),
      ],
      () => [say('Total 16 000 FCFA. On valide ? Il me faut aussi votre adresse.')],
      () => [
        toolCall('create_order', {
          items,
          delivery: { method: 'delivery', zone_id: 'dakar-plateau', address_text: 'Rue 10 x 13' },
          customer,
        }),
      ],
      () => [say('Commande créée.')],
      // Another zone changes the price: that still needs a new quote.
      () => [
        toolCall('create_order', {
          items,
          delivery: { method: 'delivery', zone_id: 'thies' },
          customer,
        }),
      ],
      () => [say('Je refais le total pour Thiès.')],
    );
    const { token } = await openChat();
    await send(token, 'La robe noire en 42, livraison au Plateau');
    await send(token, 'Oui. Fatou, +221771234567, rue 10 x 13');
    expect(core.orders).toHaveLength(1);
    expect(core.orders[0]?.total).toBe(16000);
    await send(token, 'Finalement livrez à Thiès');
    expect(core.orders).toHaveLength(1);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain('QUOTE_REQUIRED');
  });

  it('caps a discount at the vendor limit, whatever the model asks', async () => {
    const { openChat, send, llm, core } = setup();
    const items = [{ variant_id: variantOf(core, 'boubou-bazin-bleu'), quantity: 1 }];
    llm.push(
      () => [toolCall('quote_cart', { items, delivery: { method: 'pickup' }, discount_pct: 50 })],
      () => [say('Je peux faire 31 500 FCFA au mieux.')],
    );
    const { token } = await openChat();
    await send(token, 'Dernier prix ?');
    const toolResult = JSON.parse(
      (llm.requests[1]?.messages.at(-1)?.content[0] as { content: string }).content,
    ) as {
      total: { amount: number };
      applied_discount_pct: number;
    };
    expect(toolResult.applied_discount_pct).toBe(10);
    expect(toolResult.total.amount).toBe(31500);
  });
});

describe('handoff and the vendor inbox', () => {
  it('hands over by code when the customer asks for a person, without a model call', async () => {
    const { openChat, send, history, llm, core, store } = setup();
    const { token, conversationId } = await openChat();
    await send(token, 'Je veux parler au vendeur');
    expect(llm.requests).toHaveLength(0);
    expect((await store.getConversation(conversationId))?.mode).toBe('human');
    expect(core.notifications.at(-1)).toMatchObject({ type: 'conversation.handoff' });
    expect((await history(token)).at(-1)?.text).toBe(
      'Je transmets votre message au vendeur, il vous répond très vite.',
    );
  });

  it('hands off, stays silent in human mode, and lets the vendor answer', async () => {
    const { app, openChat, send, history, llm, core, vendorHeaders } = setup();
    llm.push(
      () => [
        toolCall('handoff_to_vendor', {
          reason: 'complaint',
          summary: 'Commande abîmée',
        }),
      ],
      () => [say('Je préviens le vendeur, il vous répond ici.')],
    );
    const { token, conversationId } = await openChat();
    await send(token, 'Ma commande est arrivée abîmée');
    expect(core.notifications.at(-1)).toMatchObject({ type: 'conversation.handoff' });

    await send(token, 'Vous êtes là ?');
    expect(llm.requests).toHaveLength(2); // no new model call in human mode

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: vendorHeaders,
    });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data[0]).toMatchObject({
      id: conversationId,
      mode: 'human',
      unread_count: 2,
    });

    const vendorMsg = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: vendorHeaders,
      payload: {
        client_message_id: 'vendor-msg-001',
        text: 'Bonjour, c’est Awa. 18 000 pour vous.',
      },
    });
    expect(vendorMsg.statusCode).toBe(201);
    expect((await history(token)).at(-1)).toMatchObject({
      author: 'vendor',
      author_label: 'Awa Style (vendeur)',
    });

    // Back to bot: the vendor answered what was waiting, so the bot stays quiet.
    const mode = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/mode`,
      headers: vendorHeaders,
      payload: { mode: 'bot' },
    });
    expect(mode.json()).toMatchObject({ mode: 'bot', human_until: null });
    await app.services.turns.idle();
    expect(llm.requests).toHaveLength(2);
  });

  it('lets the vendor show products and make the order, which the customer pays from the chat', async () => {
    const { app, openChat, history, core, vendorHeaders } = setup();
    const { token, conversationId } = await openChat();
    const robe = core.products.find((p) => p.slug === 'robe-wax-noire');
    const url = (path: string) => `/api/v1/conversations/${conversationId}/${path}`;

    // A product card, with or without words.
    const shown = await app.inject({
      method: 'POST',
      url: url('messages'),
      headers: vendorHeaders,
      payload: { client_message_id: 'vendor-card-01', product_ids: [robe?.id] },
    });
    expect(shown.statusCode).toBe(201);
    expect((await history(token)).at(-1)).toMatchObject({
      author: 'vendor',
      cards: [{ type: 'product', product_id: robe?.id, title: 'Robe wax noire' }],
    });

    // The exact total, then the order with that total.
    const items = [{ variant_id: variantOf(core, 'robe-wax-noire', '42'), quantity: 1 }];
    const delivery = { method: 'pickup' as const };
    const quote = await app.inject({
      method: 'POST',
      url: url('quotes'),
      headers: vendorHeaders,
      payload: { items, delivery },
    });
    expect(quote.statusCode).toBe(200);
    const order = () =>
      app.inject({
        method: 'POST',
        url: url('orders'),
        headers: { ...vendorHeaders, 'idempotency-key': 'vendor-order-key-0001' },
        payload: {
          client_message_id: 'vendor-order-01',
          customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
          items,
          delivery,
          expected_total: quote.json().total,
        },
      });
    const made = await order();
    expect(made.statusCode).toBe(201);
    const card = (await history(token)).at(-1);
    expect(card).toMatchObject({
      author: 'vendor',
      kind: 'order_link',
      cards: [{ type: 'order', status: 'pending_payment', checkout_url: expect.any(String) }],
    });
    // A double tap replays: one order, one card.
    expect((await order()).statusCode).toBe(201);
    expect(core.orders).toHaveLength(1);

    // Neither an empty message nor a stale total gets through.
    const empty = await app.inject({
      method: 'POST',
      url: url('messages'),
      headers: vendorHeaders,
      payload: { client_message_id: 'vendor-empty-1' },
    });
    expect(empty.statusCode).toBe(422);
    const stale = await app.inject({
      method: 'POST',
      url: url('orders'),
      headers: { ...vendorHeaders, 'idempotency-key': 'vendor-order-key-0002' },
      payload: {
        client_message_id: 'vendor-order-02',
        customer: { display_name: 'Fatou', phone_e164: '+221771234567' },
        items,
        delivery,
        expected_total: { amount: 1, currency: 'XOF' },
      },
    });
    expect(stale.json().code).toBe('PRICE_CHANGED');
  });

  it('answers the waiting message when the vendor gives the chat back to the bot', async () => {
    const { app, openChat, send, history, llm, vendorHeaders } = setup();
    const { token, conversationId } = await openChat();
    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/mode`,
      headers: vendorHeaders,
      payload: { mode: 'paused' },
    });
    await send(token, 'Vous livrez à Thiès ?');
    expect(llm.requests).toHaveLength(0);
    llm.push(() => [say('Oui, nous livrons à Thiès.')]);
    await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/mode`,
      headers: vendorHeaders,
      payload: { mode: 'bot' },
    });
    await app.services.turns.idle();
    expect((await history(token)).at(-1)?.text).toBe('Oui, nous livrons à Thiès.');
  });

  it('rejects inbox calls without a session, from another origin, or for another vendor', async () => {
    const { app, openChat } = setup();
    const { conversationId } = await openChat();
    expect((await app.inject({ method: 'GET', url: '/api/v1/conversations' })).statusCode).toBe(
      401,
    );
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/mode`,
      headers: { cookie: 'selly_session=dev-vendor-session', origin: 'https://evil.example' },
      payload: { mode: 'human' },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    const other = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: { cookie: 'selly_session=someone-else' },
    });
    expect(other.statusCode).toBe(401);
  });
});

describe('plan limits and voice notes', () => {
  it('gives the fixed reply and alerts the vendor when the monthly quota is used up', async () => {
    const { openChat, send, history, llm, core } = setup();
    core.usage.agent_turns = 1500;
    const { token } = await openChat();
    await send(token, 'Bonjour');
    expect(llm.requests).toHaveLength(0);
    expect((await history(token)).at(-1)?.text).toBe(
      'Je transmets votre message au vendeur, il vous répond très vite.',
    );
    expect(core.notifications.map((n) => n.type)).toContain('usage.warning');
  });

  it('reports one agent turn per reply', async () => {
    const { openChat, send, llm, core } = setup();
    llm.push(() => [say('Bonjour !')]);
    const { token } = await openChat();
    await send(token, 'Salam');
    expect(core.usage.agent_turns).toBe(1);
  });

  async function uploadVoice(
    s: ReturnType<typeof setup>,
    token: string,
    contentType: string,
    bytes: number[],
  ) {
    const up = await s.app.inject({
      method: 'POST',
      url: '/api/v1/chat/uploads',
      headers: { authorization: `Bearer ${token}` },
      payload: { content_type: contentType, size_bytes: bytes.length },
    });
    expect(up.statusCode).toBe(201);
    const put = await s.app.inject({
      method: 'PUT',
      url: new URL(up.json().upload_url).pathname,
      headers: { 'content-type': contentType },
      payload: Buffer.from(bytes),
    });
    expect(put.statusCode).toBe(200);
    return up.json().storage_key as string;
  }

  it('transcribes a voice note and answers it', async () => {
    const s = setup({
      asr: new ScriptedAsr({ text: 'Vous avez la robe en 40 ?', confidence: 0.9, language: 'fr' }),
    });
    s.llm.push(() => [say('Oui, en 40 il en reste 3.')]);
    const { token } = await s.openChat();
    const key = await uploadVoice(s, token, 'audio/webm', [1, 2, 3, 4]);
    const res = await s.send(token, '', { kind: 'audio', media_key: key, text: undefined });
    expect(res.statusCode).toBe(202);
    expect(JSON.stringify(s.llm.requests[0]?.messages)).toContain('Vous avez la robe en 40 ?');
    expect((await s.history(token)).at(-1)?.text).toBe('Oui, en 40 il en reste 3.');
  });

  it('asks for a written message when the voice note is not understood', async () => {
    const s = setup({
      asr: new ScriptedAsr({ text: '...', confidence: 0.2, language: 'unknown' }),
    });
    const { token } = await s.openChat();
    const key = await uploadVoice(s, token, 'audio/ogg', [1, 2]);
    await s.send(token, '', { kind: 'audio', media_key: key, text: undefined });
    expect(s.llm.requests).toHaveLength(0);
    expect((await s.history(token)).at(-1)?.text).toBe(
      'Je n’ai pas bien compris le vocal, pouvez-vous l’écrire ?',
    );
  });
});
