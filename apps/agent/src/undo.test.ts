import { afterEach, describe, expect, it, vi } from 'vitest';
import { say, toolCall } from './engine/scripted';
import { setup } from './test-helpers';

let seq = 0;
async function assistant(s: ReturnType<typeof setup>, payload: Record<string, unknown>) {
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/v1/assistant/messages',
    headers: s.vendorHeaders,
    payload: { client_message_id: `undo-test-${++seq}`, ...payload },
  });
  expect(res.statusCode).toBe(200);
  return res.json().reply as { text: string; quick_replies: { id: string; label: string }[] };
}

afterEach(() => vi.useRealTimers());

describe('« Annuler » after a risky change (section 8.4)', () => {
  it('offers Annuler after a price change over 30 %, and undoes it in code', async () => {
    const s = setup();
    const robe = s.core.products.find((p) => p.slug === 'robe-wax-noire');
    s.llm.push(
      () => [
        toolCall('update_price', {
          product_ref: 'Robe wax noire',
          price: { amount: 5000, currency: 'XOF' },
        }),
      ],
      () => [say('Prix changé : 5 000 FCFA.')],
    );
    const reply = await assistant(s, { text: 'La robe wax passe à 5 000' });
    expect(robe?.priceXof).toBe(5000);
    expect(reply.quick_replies).toEqual([
      { id: expect.stringMatching(/^undo:/), label: 'Annuler' },
    ]);

    const calls = s.llm.requests.length;
    const undone = await assistant(s, { quick_reply_id: reply.quick_replies[0]?.id });
    expect(undone.text).toBe('Annulé : Robe wax noire revient à 15 000 FCFA.');
    expect(robe?.priceXof).toBe(15000);
    expect(s.llm.requests.length).toBe(calls); // no model call for the undo

    // A second tap has nothing left to undo.
    const again = await assistant(s, { quick_reply_id: reply.quick_replies[0]?.id });
    expect(again.text).toBe('Il n’y a rien à annuler.');
  });

  it('does not offer Annuler for a small price change', async () => {
    const s = setup();
    s.llm.push(
      () => [
        toolCall('update_price', {
          product_ref: 'Robe wax noire',
          price: { amount: 16000, currency: 'XOF' },
        }),
      ],
      () => [say('Prix changé : 16 000 FCFA.')],
    );
    const reply = await assistant(s, { text: 'La robe wax passe à 16 000' });
    expect(reply.quick_replies.map((q) => q.label)).not.toContain('Annuler');
  });

  it('offers Annuler after a stock set to 0, and puts the stock back', async () => {
    const s = setup();
    const v = s.core.products
      .find((p) => p.slug === 'robe-wax-noire')
      ?.variants.find((x) => x.options.size === '40');
    s.llm.push(
      () => [
        toolCall('adjust_stock', {
          product_ref: 'Robe wax noire',
          options: { size: '40' },
          set_to: 0,
          reason: 'adjustment',
        }),
      ],
      () => [say('Plus de robe en 40.')],
    );
    const reply = await assistant(s, { text: 'Plus de robe wax en 40' });
    expect(v?.onHand).toBe(0);
    const undone = await assistant(s, { quick_reply_id: reply.quick_replies[0]?.id });
    expect(undone.text).toBe('Annulé : Robe wax noire 40 noir revient à 3 en stock.');
    expect(v?.onHand).toBe(3);
  });

  it('refuses to undo after 5 minutes', async () => {
    const s = setup();
    s.llm.push(
      () => [
        toolCall('update_price', {
          product_ref: 'Robe wax noire',
          price: { amount: 30000, currency: 'XOF' },
        }),
      ],
      () => [say('Prix changé : 30 000 FCFA.')],
    );
    const reply = await assistant(s, { text: 'La robe wax passe à 30 000' });
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000, toFake: ['Date'] });
    const late = await assistant(s, { quick_reply_id: reply.quick_replies[0]?.id });
    expect(late.text).toContain('délai de 5 minutes');
    expect(s.core.products.find((p) => p.slug === 'robe-wax-noire')?.priceXof).toBe(30000);
  });
});
