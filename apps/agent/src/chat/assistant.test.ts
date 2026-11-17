import { describe, expect, it } from 'vitest';
import { say, toolCall } from '../engine/scripted';
import { uuidv7 } from '../ids';
import { APP, FAKE_VENDOR_ID, setup } from '../test-helpers';
import type { Extraction } from '../vision';

const extraction: Extraction = {
  title: { value: 'Baskets montantes', confidence: 0.9, from: 'image' },
  description: { value: 'Baskets montantes en toile.', confidence: 0.8, from: 'image' },
  category: { value: 'chaussures', confidence: 0.8, from: 'inferred' },
  price: { value: { amount: 20000, currency: 'XOF' }, confidence: 0.95, from: 'text' },
  variants: {
    value: ['40', '41', '42', '43', '44'].map((size) => ({
      options: { size, color: null },
      stock: null,
    })),
    confidence: 0.7,
    from: 'text',
  },
  questions: [
    {
      id: 'stock_split',
      text: '5 au total ou 5 par pointure ?',
      choices: ['5 au total', '5 par pointure'],
    },
  ],
};

describe('vendor assistant', () => {
  it('turns a photo and a sentence into a draft, asks the question, and publishes after Valider', async () => {
    const s = setup({
      imageResolver: async (key) => ({
        type: 'image',
        mediaType: 'image/jpeg',
        url: `https://media.example/${key}`,
      }),
    });
    s.llm.push(
      () => [
        toolCall('create_product_draft', {
          text: 'Ajoute ces baskets à 20 000, 5 paires du 40 au 44',
        }),
      ],
      // The extraction call made by the tool: structured output.
      (req) => {
        expect(req.purpose).toBe('extraction');
        expect(req.jsonSchema).toBeDefined();
        expect(req.messages[0]?.content[0]).toMatchObject({
          type: 'image',
          url: 'https://media.example/uploads/v1/a.jpg',
        });
        return [say(JSON.stringify(extraction))];
      },
      () => [say('Baskets montantes à 20 000 FCFA, du 40 au 44. 5 au total ou 5 par pointure ?')],
    );
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
      payload: {
        client_message_id: 'assist-0001',
        text: 'Ajoute ces baskets à 20 000, 5 paires du 40 au 44',
        image_keys: ['uploads/v1/a.jpg'],
      },
    });
    expect(res.statusCode).toBe(200);
    const turn = res.json();
    expect(turn.message).toMatchObject({ author: 'vendor', status: 'processed' });
    expect(turn.reply.text).toContain('5 au total ou 5 par pointure ?');
    expect(turn.reply.quick_replies.map((q: { label: string }) => q.label)).toEqual([
      '5 au total',
      '5 par pointure',
    ]);
    expect(s.core.usage.drafts).toBe(1);

    // The vendor tools were offered, never the sales tools.
    expect(s.llm.requests[0]?.tools?.map((t) => t.name)).toContain('confirm_product_draft');
    expect(s.llm.requests[0]?.tools?.map((t) => t.name)).not.toContain('create_order');

    const draftId = [...s.core.drafts.keys()][0] as string;
    s.llm.push(
      () => [
        toolCall('answer_draft_question', {
          draft_id: draftId,
          question_id: 'stock_split',
          answer: '5 par pointure',
        }),
      ],
      () => [
        say(
          'Baskets montantes, 20 000 FCFA, du 40 au 44, 5 par pointure. Je valide ?\nBoutons: Valider | Modifier',
        ),
      ],
      () => [toolCall('confirm_product_draft', { draft_id: draftId, mode: 'new' })],
      () => [say('Ajouté au catalogue.')],
    );
    await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
      payload: { client_message_id: 'assist-0002', quick_reply_id: 'stock_split:1' },
    });
    const before = s.core.products.length;
    const done = await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
      payload: { client_message_id: 'assist-0003', text: 'Valider' },
    });
    expect(done.json().reply.text).toBe('Ajouté au catalogue.');
    expect(s.core.products.length).toBe(before + 1);
    expect(s.core.drafts.get(draftId)?.status).toBe('confirmed');

    // A retry with the same client_message_id returns the same reply without a new turn.
    const calls = s.llm.requests.length;
    const retry = await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
      payload: { client_message_id: 'assist-0003', text: 'Valider' },
    });
    expect(retry.json().reply.id).toBe(done.json().reply.id);
    expect(s.llm.requests.length).toBe(calls);

    const history = await s.app.inject({
      method: 'GET',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
    });
    expect(history.json().data.length).toBe(6);
  });

  it('changes stock by product name and size', async () => {
    const s = setup();
    s.llm.push(
      () => [
        toolCall('adjust_stock', {
          product_ref: 'Robe wax noire',
          options: { size: '42' },
          set_to: 5,
          reason: 'restock',
        }),
      ],
      () => [say('C’est fait : 5 robes en 42.')],
    );
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: s.vendorHeaders,
      payload: { client_message_id: 'assist-stock-1', text: 'Robe wax noire, 5 en 42' },
    });
    expect(res.json().reply.text).toBe('C’est fait : 5 robes en 42.');
    const v = s.core.products
      .find((p) => p.slug === 'robe-wax-noire')
      ?.variants.find((x) => x.options.size === '42');
    expect(v?.onHand).toBe(5);
  });

  it('requires a vendor session', async () => {
    const s = setup();
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/messages',
      headers: { origin: APP },
      payload: { client_message_id: 'assist-x-001', text: 'Bonjour' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('internal API', () => {
  it('runs one synchronous turn for tests and returns the tool calls', async () => {
    const s = setup();
    s.llm.push(
      () => [toolCall('get_shop_info', { topic: 'delivery' })],
      () => [say('Livraison à Dakar Plateau : 1 000 FCFA.')],
    );
    const res = await s.app.inject({
      method: 'POST',
      url: '/internal/v1/agent/chat',
      headers: { authorization: 'Bearer test-token' },
      payload: { vendor_id: FAKE_VENDOR_ID, message_text: 'Vous livrez où ?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reply.text).toBe('Livraison à Dakar Plateau : 1 000 FCFA.');
    expect(res.json().tool_calls).toEqual([
      { name: 'get_shop_info', arguments: { topic: 'delivery' }, ok: true },
    ]);
  });

  it('rejects a wrong service token', async () => {
    const s = setup();
    const res = await s.app.inject({
      method: 'POST',
      url: '/internal/v1/agent/chat',
      headers: { authorization: 'Bearer nope' },
      payload: { vendor_id: FAKE_VENDOR_ID, message_text: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('extracts a dashboard draft in the background on draft.requested', async () => {
    const s = setup();
    const draft = await s.core.upsertDraft(FAKE_VENDOR_ID, { image_keys: ['uploads/x.jpg'] });
    s.llm.push(() => [say(JSON.stringify(extraction))]);
    const res = await s.postEvent({
      event_id: uuidv7(),
      type: 'draft.requested',
      occurred_at: new Date().toISOString(),
      vendor_id: FAKE_VENDOR_ID,
      data: { draft_id: draft.id, image_keys: ['uploads/x.jpg'], input_text: 'Baskets à 20 000' },
    });
    expect(res.statusCode).toBe(200);
    await s.app.services.turns.idle();
    expect(s.core.drafts.get(draft.id)).toMatchObject({
      status: 'needs_review',
      questions: extraction.questions,
    });
  });
});
