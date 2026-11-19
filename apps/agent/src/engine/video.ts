// The demo video's provider (LLM_PRIMARY=video): no API key, no model. It plays the script of
// video/SCRIPT.md in English, through the real tools, so the stock, the order and the product draft
// on screen are real rows. Lines outside the script get a short holding answer.

import type { SearchResult } from '../core/types';
import type { LlmBlock, LlmProvider, LlmRequest, LlmResponse } from './llm';

let seq = 0;
const call = (name: string, input: Record<string, unknown>): LlmBlock => ({
  type: 'tool_use',
  id: `video_${++seq}`,
  name,
  input,
});
const say = (text: string): LlmBlock => ({ type: 'text', text });

/** The customer of the video. The number is a placeholder; it never shows on screen. */
const CUSTOMER = { display_name: 'Fatou', phone_e164: '+221770000000' };
const PRODUCT_QUERY = 'white sneakers';
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const fcfa = (n: number) => `${n.toLocaleString('en-US')} FCFA`;
const sizeIn = (text: string) => /\b(3[4-9]|4[0-6])\b/.exec(text)?.[1];

type Zone = { id: string; label: string; fee: { amount: number } };

/** The shop and the conversation state, from the dynamic part of the system prompt (prompt.ts). */
function context(req: LlmRequest) {
  const tag = (name: string) => {
    const m = new RegExp(`<${name}>(.*?)</${name}>`, 's').exec(req.system.dynamic);
    try {
      return m ? (JSON.parse(m[1] as string) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const shop = tag('boutique') as { livraison?: { zones?: Zone[] } };
  const state = tag('etat') as { draftId?: string };
  return { zones: shop.livraison?.zones ?? [], draftId: state.draftId };
}

/** What the person wrote, turn by turn: user messages without the tool results and the engine's own notes. */
const personLines = (req: LlmRequest) =>
  req.messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      m.content
        .map((b) => (b.type === 'text' && !b.text.startsWith('[Contrôle') ? b.text : ''))
        .join(' ')
        .trim(),
    )
    .filter(Boolean);

export class VideoProvider implements LlmProvider {
  readonly name = 'video';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const content =
      req.purpose === 'extraction'
        ? [say(JSON.stringify(extraction()))]
        : req.purpose === 'summary'
          ? [say('The customer asked about the white sneakers in size 42, delivered to Mermoz.')]
          : req.tools?.some((t) => t.name === 'create_product_draft')
            ? vendorTurn(req)
            : customerTurn(req);
    return {
      content,
      stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      model: 'video',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

/** This turn's tool results by tool name (the calls of the previous assistant message). */
function results(req: LlmRequest): Record<string, unknown> {
  const msgs = req.messages;
  const last = msgs.at(-1);
  const asked = msgs.at(-2);
  const out: Record<string, unknown> = {};
  for (const b of last?.content ?? []) {
    if (b.type !== 'tool_result') continue;
    const use = asked?.content.find((u) => u.type === 'tool_use' && u.id === b.toolUseId);
    if (use?.type === 'tool_use') out[use.name] = JSON.parse(b.content);
  }
  return out;
}

/** The customer's lines (SCRIPT.md, shot 5): the size, then the delivery and the order. */
function customerTurn(req: LlmRequest): LlmBlock[] {
  const got = results(req);
  const userTexts = personLines(req);
  const lastText = userTexts.at(-1) ?? '';
  const size = sizeIn(lastText) ?? userTexts.map(sizeIn).findLast(Boolean) ?? '42';
  const product = (got.search_products as SearchResult | undefined)?.results[0];
  const variant = product?.variants.find((v) => Object.values(v.options).includes(size));
  // The zone whose label names a place of the message ("Mermoz" in "Mermoz, Sacré-Cœur").
  const lower = lastText.toLowerCase();
  let place = '';
  const zones = context(req).zones;
  const zone =
    zones.find((z) =>
      z.label.split(/,\s*/).some((p) => lower.includes(p.toLowerCase()) && (place = p)),
    ) ?? zones[0];
  const asksDelivery = /deliver|how much|livr/i.test(lastText) || place !== '';

  if (got.create_order) {
    const o = got.create_order as { total: { amount: number } };
    const fee = zone?.fee.amount ?? 0;
    return [
      say(
        `Delivery to ${place || zone?.label || 'your area'} is ${fcfa(fee)}, so ${fcfa(o.total.amount)} in all. Your order is ready: pay with the button below.`,
      ),
    ];
  }
  if (got.quote_cart && variant) {
    return [
      call('create_order', {
        items: [{ variant_id: variant.variant_id, quantity: 1 }],
        delivery: { method: 'delivery', zone_id: zone?.id },
        customer: CUSTOMER,
      }),
    ];
  }
  if (got.search_products) {
    if (!product || !variant) return [say('Let me check that and come back to you.')];
    if (asksDelivery && zone)
      return [
        call('search_products', { query: PRODUCT_QUERY, size }),
        call('quote_cart', {
          items: [{ variant_id: variant.variant_id, quantity: 1 }],
          delivery: { method: 'delivery', zone_id: zone.id },
        }),
      ];
    const left = variant.available;
    return [
      say(
        left > 0
          ? `Mangi fi, jërëjëf! Yes, the ${product.title.toLowerCase()} are in stock in size ${size}: ${NUMBER_WORDS[left] ?? left} pair${left > 1 ? 's' : ''} left, ${fcfa(product.price.amount)}.`
          : `Mangi fi, jërëjëf! The ${product.title.toLowerCase()} are sold out in size ${size} for now.`,
      ),
    ];
  }
  if (sizeIn(lastText) || asksDelivery)
    return [call('search_products', { query: PRODUCT_QUERY, size })];
  return [say('Hello! Which item are you looking for?')];
}

/** The vendor's lines (SCRIPT.md, shot 4): a photo and a sentence, then one tap to publish. */
function vendorTurn(req: LlmRequest): LlmBlock[] {
  const got = results(req);
  const lastText = personLines(req).at(-1) ?? '';
  const { draftId } = context(req);

  if (got.confirm_product_draft)
    return [say('Done! The white sneakers are in your shop now, 10 pairs in stock.')];
  if (got.create_product_draft)
    return [
      say(
        'Here is the product: White sneakers, 20,000 FCFA, sizes 40 to 44, two pairs each. Shall I publish it?',
      ),
    ];
  if (/photo/i.test(lastText)) {
    const words = lastText.replace(/\[[^\]]*photo[^\]]*\]/gi, '').trim();
    return [call('create_product_draft', { text: words })];
  }
  if (draftId && /confirm|valider|publish|yes/i.test(lastText))
    return [call('confirm_product_draft', { draft_id: draftId, mode: 'new' })];
  return [say('Send me a photo and a sentence, and I will build the product.')];
}

/** What the "model" reads in the sneakers photo and the vendor's sentence. */
function extraction() {
  const sure = (value: unknown, from = 'text') => ({ value, confidence: 0.95, from });
  return {
    title: sure('White sneakers'),
    description: sure(
      'Clean white low-top sneakers, light and comfortable for every day. Sizes 40 to 44.',
      'image',
    ),
    category: { value: 'Shoes', confidence: 0.85, from: 'image' },
    price: sure({ amount: 20000, currency: 'XOF' }),
    variants: sure(
      ['40', '41', '42', '43', '44'].map((size) => ({ options: { size, color: null }, stock: 2 })),
    ),
    questions: [],
  };
}
