import { describe, expect, it } from 'vitest';
import { ScriptedProvider, say, toolCall } from '../src/engine/scripted';
import { CASES } from './cases';
import { callCostUsd, grade, guessLanguage, normalise, partialMatch } from './grade';
import { runCase, summarise } from './run';

describe('evaluation set', () => {
  it('has about a hundred cases with unique ids, in every language', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const lang of ['fr', 'en', 'wo', 'mixed'])
      expect(CASES.some((c) => c.lang === lang)).toBe(true);
    expect(CASES.filter((c) => c.role === 'vendor').length).toBeGreaterThanOrEqual(10);
  });
});

describe('grading', () => {
  const base = { reply: '', toolCalls: [], mode: 'bot' as const, latencyMs: 100 };
  const avail = CASES.find((c) => c.id === 'avail-01');
  if (!avail) throw new Error('missing case');

  it('passes a turn with the right tool and the right fact, written any usual way', () => {
    for (const reply of ['Oui, 15 000 FCFA.', 'Oui, 15 000 FCFA.', 'Oui, 15.000 F CFA.']) {
      const g = grade(avail, {
        ...base,
        reply,
        toolCalls: [{ name: 'search_products', arguments: { query: 'robe noire' }, ok: true }],
      });
      expect(g.pass).toBe(true);
    }
  });

  it('fails a missing tool, a forbidden tool, a missing fact and the wrong language', () => {
    const g = grade(avail, {
      ...base,
      reply: 'Yes, it is available.',
      toolCalls: [{ name: 'create_order', arguments: {}, ok: true }],
    });
    expect(g).toMatchObject({ pass: false, tools: false, facts: false, language: false });
    expect(g.problems.join(' ')).toMatch(
      /missing tool search_products.*forbidden tool create_order/,
    );
  });

  it('checks arguments partially and handoffs', () => {
    const v = CASES.find((c) => c.id === 'vendor-01');
    const h = CASES.find((c) => c.id === 'handoff-01');
    if (!v || !h) throw new Error('missing case');
    expect(
      grade(v, {
        ...base,
        reply: 'C’est fait.',
        toolCalls: [
          { name: 'adjust_stock', arguments: { product_ref: 'robe', set_to: 2 }, ok: true },
        ],
      }).args,
    ).toBe(true);
    expect(
      grade(h, {
        ...base,
        reply: 'Je préviens le vendeur.',
        toolCalls: [{ name: 'handoff_to_vendor', arguments: {}, ok: true }],
      }).handoff,
    ).toBe(false);
    expect(
      partialMatch(
        { price: { amount: 17000, currency: 'XOF' }, x: 1 },
        { price: { amount: 17000 } },
      ),
    ).toBe(true);
  });

  it('normalises text and guesses the language', () => {
    expect(normalise('Élégant  15 000')).toBe('elegant 15 000');
    expect(guessLanguage('Oui, il en reste deux pour vous.')).toBe('fr');
    expect(guessLanguage('Yes, we have it for you.')).toBe('en');
  });

  it('prices a call, cached tokens included', () => {
    expect(
      callCostUsd({
        model: 'claude-opus-5-5',
        inputTokens: 10_000,
        outputTokens: 200,
        cacheReadTokens: 8_000,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo((2_000 * 4 + 8_000 * 0.2 + 200 * 20) / 1_000_000);
    expect(
      callCostUsd({
        model: 'unknown',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });
});

describe('runner, with a scripted model', () => {
  it('runs single and multi-turn cases end to end and summarises them', async () => {
    const avail = CASES.find((c) => c.id === 'avail-01');
    const handoff = CASES.find((c) => c.id === 'handoff-01');
    if (!avail || !handoff) throw new Error('missing case');
    const r1 = await runCase(
      avail,
      () =>
        new ScriptedProvider([
          () => [toolCall('search_products', { query: 'robe noire', size: '42' })],
          () => [say('Oui, la robe wax noire en 42 est à 15 000 FCFA.')],
        ]),
    );
    expect(r1.grade).toMatchObject({ pass: true });
    const r2 = await runCase(
      handoff,
      () =>
        new ScriptedProvider([
          () => [
            toolCall('handoff_to_vendor', {
              reason: 'customer_request',
              summary: 'Veut le vendeur',
            }),
          ],
          () => [say('Je préviens le vendeur, il vous répond ici.')],
        ]),
    );
    expect(r2.grade).toMatchObject({ pass: true, handoff: true });
    const s = summarise([r1, r2], 'scripted', 0.9);
    expect(s).toMatchObject({ cases: 2, pass: 100, errors: 0 });
  });
});

describe('speech to text', () => {
  it('computes the word error rate', async () => {
    const { wer } = await import('./asr-eval');
    expect(wer('robe bu ñuul bi', 'robe bu ñuul bi')).toBe(0);
    expect(wer('robe bu ñuul bi', 'robe bu nuul')).toBe(0.25);
    expect(wer('a b c d', 'x y')).toBe(1);
  });

  it('reads a transcript from the HTTP contract, and clamps a wrong confidence', async () => {
    const { HttpAsr } = await import('../src/asr');
    const seen: { url: string; type: string | null }[] = [];
    const asr = new HttpAsr('https://asr.example/transcribe', 'k', 1000, (async (
      url: string,
      init: RequestInit,
    ) => {
      seen.push({ url, type: new Headers(init.headers).get('content-type') });
      return new Response(JSON.stringify({ text: 'Robe bi', confidence: 1.4, language: 'wo' }));
    }) as unknown as typeof fetch);
    expect(await asr.transcribe(Buffer.from([1, 2]), 'audio/ogg')).toEqual({
      text: 'Robe bi',
      confidence: 1,
      language: 'wo',
    });
    expect(seen[0]).toEqual({ url: 'https://asr.example/transcribe', type: 'audio/ogg' });
  });
});
