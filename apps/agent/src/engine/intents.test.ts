import { describe, expect, it } from 'vitest';
import { setup } from '../test-helpers';
import { asksForHuman, claimsOrder, negotiates, totalsIn } from './intents';
import { salvageTextToolCalls } from './openai-compatible';
import { say } from './scripted';

// The examples are real messages of the evaluation set and real replies of ollama:qwen2.5:7b.
describe('what the customer asks for', () => {
  it('recognises a request for a person', () => {
    for (const t of [
      'Je veux parler au vendeur',
      'Passez-moi Awa svp',
      'Vous êtes un robot ? Je veux un humain',
      'I want to talk to the owner',
    ])
      expect(asksForHuman(t), t).toBe(true);
    for (const t of [
      'Le vendeur livre à Thiès ?',
      'Passez-moi le prix du sac',
      'Robe noire en 42 dispo ?',
    ])
      expect(asksForHuman(t), t).toBe(false);
  });

  it('recognises bargaining', () => {
    for (const t of [
      'Dernier prix pour le boubou ?',
      'Faites-moi la robe à 10 000',
      'Si je prends 2 paires vous faites une remise ?',
      'Vous pouvez baisser un peu le sac ?',
      'Wàññil ma tuuti ci boubou bi',
    ])
      expect(negotiates(t), t).toBe(true);
    for (const t of ['C’est combien la robe wax ?', 'Livraison à Thiès possible ?'])
      expect(negotiates(t), t).toBe(false);
  });
});

describe('what the reply claims', () => {
  it('sees an order claimed in words and a total', () => {
    expect(claimsOrder('Commande créée avec succès. Total 15 000 FCFA.')).toBe(true);
    expect(claimsOrder('Votre commande a été enregistrée.')).toBe(true);
    expect(claimsOrder('Souhaitez-vous passer la commande ?')).toBe(false);
    expect(totalsIn('Le total de votre commande est de 20 000 FCFA.')).toEqual([20000]);
    expect(totalsIn('Total : 16 000 FCFA (27 103 sats).')).toEqual([16000]);
    expect(totalsIn('La robe coûte 15 000 FCFA.')).toEqual([]);
  });
});

describe('tool calls written as text', () => {
  it('runs them and removes the raw JSON from the reply', () => {
    const r = salvageTextToolCalls(
      'D\'accord, je vais vérifier les détails avec l\'outil.\nONGL {"name": "search_products", "arguments": {"query": "sac", "limit": 1}} </tool_call>',
      new Set(['search_products']),
    );
    expect(r.calls).toEqual([
      {
        type: 'tool_use',
        id: 'text_call_1',
        name: 'search_products',
        input: { query: 'sac', limit: 1 },
      },
    ]);
    expect(r.text).not.toContain('{');
    expect(r.text).not.toContain('tool_call');
  });

  it('leaves unknown names and ordinary text alone', () => {
    const text = 'Voici : {"name": "rm_rf", "arguments": {}} et rien d’autre.';
    expect(salvageTextToolCalls(text, new Set(['search_products']))).toEqual({ text, calls: [] });
  });
});

describe('the engine', () => {
  it('does not accept the price the customer names while bargaining', async () => {
    const { openChat, send, history, llm } = setup();
    llm.push(
      () => [say('Je vous ai trouvé une robe noire pour 10 000 FCFA. Voulez-vous la commander ?')],
      () => [say('Je vous la fais à 10 000 FCFA.')],
    );
    const { token } = await openChat();
    await send(token, 'Faites-moi la robe à 10 000');
    expect(llm.requests[0]?.system.dynamic).toContain('Le client négocie');
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain('10000');
    expect((await history(token)).at(-1)?.text).toBe(
      'Je transmets votre message au vendeur, il vous répond très vite.',
    );
  });

  it('refuses an order claimed in words and a total no quote gave', async () => {
    const { openChat, send, llm } = setup();
    llm.push(
      () => [say('Commande créée avec succès. Total 15 000 FCFA.')],
      () => [say('Je calcule le total exact d’abord.')],
      () => [say('Le total de votre commande est de 20 000 FCFA. On valide ?')],
      () => [say('Je calcule le total exact avec la livraison.')],
    );
    const { token } = await openChat();
    await send(token, 'Oui je valide, Moussa +221770001122');
    expect(JSON.stringify(llm.requests[1]?.messages.at(-1))).toContain('create_order');
    await send(token, 'Les baskets en 42, livraison Pikine');
    expect(JSON.stringify(llm.requests[3]?.messages.at(-1))).toContain('20000');
  });
});

describe('Wolof written without accents, as most customers do', () => {
  it('still recognises a request for the owner and bargaining', () => {
    for (const t of ['Dama beug wax ak borom bitik bi', 'Dama beug parler ak vendeur bi'])
      expect(asksForHuman(t), t).toBe(true);
    for (const t of [
      'Wagnil ma tuuti ci boubou bi',
      'Wanyil ma tuuti',
      'Dernier prix bi, wagnil ma ci sac bi',
    ])
      expect(negotiates(t), t).toBe(true);
  });
});
