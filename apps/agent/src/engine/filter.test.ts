import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { signEvent, verifyEventSignature } from '../chat/auth';
import { uuidv7 } from '../ids';
import { toLlmMessages } from '.';
import { extractQuickReplies, filterReply, formatXof, unbackedAmounts } from './filter';

const opts = {
  appBaseUrl: 'https://app.selly.example',
  whatsappLink: 'https://wa.me/221770000000',
};

describe('output filter', () => {
  it('keeps our links and the vendor contact, drops other links and phone numbers', () => {
    const out = filterReply(
      'Voir https://app.selly.example/s/awa/p/robe ou https://evil.example/x. Appelez le 77 123 45 67 ou https://wa.me/221770000000',
      opts,
    );
    expect(out).toContain('https://app.selly.example/s/awa/p/robe');
    expect(out).toContain('https://wa.me/221770000000');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('77 123 45 67');
  });

  it('keeps amounts such as 15 000 FCFA', () => {
    expect(filterReply('Elle coûte 15 000 FCFA.', opts)).toBe('Elle coûte 15 000 FCFA.');
  });

  it('caps the length', () => {
    expect(filterReply('a'.repeat(5000), opts).length).toBeLessThanOrEqual(1000);
  });

  it('takes « Boutons » out of the sentence it ends, as gpt-oss writes it', () => {
    // Real replies from groq:openai/gpt-oss-120b (evaluation of 17 November).
    const r = extractQuickReplies(
      'Nous avons des baskets blanches en taille 41, à 20 000 FCFA.\n\nSouhaitez‑vous une livraison ou un retrait en boutique ? Boutons: Livraison | Retrait',
    );
    expect(r.text).toBe(
      'Nous avons des baskets blanches en taille 41, à 20 000 FCFA.\n\nSouhaitez‑vous une livraison ou un retrait en boutique ?',
    );
    expect(r.quickReplies.map((q) => q.label)).toEqual(['Livraison', 'Retrait']);
  });

  it('accepts bold, quotes and a marker that is not on the last line, and never leaves it in the text', () => {
    const r = extractQuickReplies(
      'Je vous la réserve ?\n**Boutons :** « Oui » | « Non ».\nMerci !',
    );
    expect(r.text).toBe('Je vous la réserve ?\n\nMerci !');
    expect(r.quickReplies.map((q) => q.label)).toEqual(['Oui', 'Non']);
    expect(extractQuickReplies('Bonjour, que cherchez-vous ?')).toEqual({
      text: 'Bonjour, que cherchez-vous ?',
      quickReplies: [],
    });
  });

  it('turns a trailing Boutons line into at most 4 quick replies', () => {
    const r = extractQuickReplies(
      'Je la réserve ?\nBoutons: Commander | Autres tailles | Livraison | Prix | Trop',
    );
    expect(r.text).toBe('Je la réserve ?');
    expect(r.quickReplies).toEqual([
      { id: 'commander', label: 'Commander' },
      { id: 'autres_tailles', label: 'Autres tailles' },
      { id: 'livraison', label: 'Livraison' },
      { id: 'prix', label: 'Prix' },
    ]);
  });
});

describe('P5: every price in a reply appears in the turn’s tool results', () => {
  it('accepts amounts from tools in any of the usual spellings', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 10_000_000 }), (amount) => {
        const allowed = new Set([amount]);
        const spellings = [
          formatXof(amount),
          `${amount} FCFA`,
          `${amount.toLocaleString('fr-FR')} F CFA`,
          `${amount} sats`,
        ];
        return spellings.every((t) => unbackedAmounts(`Total : ${t}.`, allowed).length === 0);
      }),
    );
  });

  it('flags an amount no tool returned', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000_000 }),
        fc.integer({ min: 1, max: 1000 }),
        (amount, delta) => {
          return (
            unbackedAmounts(`Total : ${formatXof(amount + delta)}.`, new Set([amount])).length === 1
          );
        },
      ),
    );
  });
});

describe('core event signature', () => {
  it('accepts a fresh signature and rejects a wrong secret, a changed body or an old timestamp', () => {
    const body = '{"event_id":"x"}';
    const now = 1_800_000_000;
    const sig = signEvent(body, 's3cret', now);
    expect(verifyEventSignature(sig, body, 's3cret', now + 10)).toBe(true);
    expect(verifyEventSignature(sig, body, 'other', now)).toBe(false);
    expect(verifyEventSignature(sig, `${body} `, 's3cret', now)).toBe(false);
    expect(verifyEventSignature(sig, body, 's3cret', now + 301)).toBe(false);
    expect(verifyEventSignature(undefined, body, 's3cret', now)).toBe(false);
  });
});

describe('ids and history', () => {
  it('makes strictly increasing UUIDv7 ids, even within one millisecond', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7(1_800_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('maps history to alternating model messages that start with the customer', () => {
    const base = {
      conversationId: 'c',
      cards: [],
      quickReplies: [],
      mediaKey: null,
      imageKeys: [],
      quickReplyId: null,
      clientMessageId: null,
      status: 'processed' as const,
      authorLabel: null,
      createdAt: new Date(),
    };
    const msgs = toLlmMessages(
      [
        { ...base, id: '1', direction: 'out', author: 'agent', kind: 'text', text: 'Bonjour !' },
        { ...base, id: '2', direction: 'in', author: 'customer', kind: 'text', text: 'Salam' },
        { ...base, id: '3', direction: 'in', author: 'customer', kind: 'text', text: 'robe bi' },
        { ...base, id: '4', direction: 'out', author: 'vendor', kind: 'text', text: 'Je suis là' },
        {
          ...base,
          id: '5',
          direction: 'out',
          author: 'system',
          kind: 'system',
          text: 'Paiement reçu.',
        },
      ],
      {},
    );
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[0]?.content).toHaveLength(2);
  });
});

describe('order numbers the model made up', () => {
  it('flags an order number no tool returned, in the usual phrasings', async () => {
    const { unbackedOrderNumbers } = await import('./filter');
    const known = new Set(['HBA2']);
    // The real reply of ollama:qwen2.5:7b on order-08, without any create_order call.
    expect(
      unbackedOrderNumbers('Votre commande a été enregistrée.  Numéro de commande: A7K2', known),
    ).toEqual(['A7K2']);
    expect(unbackedOrderNumbers('Commande #ZZ99 confirmée', known)).toEqual(['ZZ99']);
    expect(unbackedOrderNumbers('Commande HBA2 confirmée ! Total : 18 000 FCFA', known)).toEqual(
      [],
    );
    expect(
      unbackedOrderNumbers('Je prépare la commande pour vous, voulez-vous la livraison ?', known),
    ).toEqual([]);
  });
});
