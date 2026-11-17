// A rule-based provider for the local demo (LLM_PRIMARY=demo): no API key, no model.
// It searches the catalog for whatever the customer writes and reads back the result, so the web
// widget can be built against real-looking replies. It is not an agent; use a real model for that.

import type { SearchResult } from '../core/types';
import { formatXof } from './filter';
import type { LlmBlock, LlmProvider, LlmRequest, LlmResponse } from './llm';

let seq = 0;
const STOPWORDS = new Set(
  'bonjour salut salam svp stp vous avez est ce que il y a des une un le la les en du de dispo disponible combien prix taille pointure je veux voudrais cherche'.split(
    ' ',
  ),
);

export class DemoProvider implements LlmProvider {
  readonly name = 'demo';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const last = req.messages.at(-1);
    const toolResult = last?.content.find((b) => b.type === 'tool_result');
    let content: LlmBlock[];
    if (req.purpose !== 'reply') {
      content = [{ type: 'text', text: req.jsonSchema ? '{}' : '' }];
    } else if (toolResult && toolResult.type === 'tool_result') {
      content = [{ type: 'text', text: describe(toolResult.content) }];
    } else if (!req.tools?.some((t) => t.name === 'search_products')) {
      content = [
        {
          type: 'text',
          text: 'Mode démo : l’assistant du vendeur a besoin d’un vrai modèle (LLM_PRIMARY).',
        },
      ];
    } else {
      const text = last?.content.map((b) => (b.type === 'text' ? b.text : '')).join(' ') ?? '';
      const lower = text.toLowerCase();
      if (/livr|delivery|zone/.test(lower)) {
        content = [
          {
            type: 'tool_use',
            id: `demo_${++seq}`,
            name: 'get_shop_info',
            input: { topic: 'delivery' },
          },
        ];
      } else {
        const size = /\b(3[4-9]|4[0-6]|xs|s|m|l|xl)\b/i.exec(text)?.[1];
        const words = lower
          .replace(/[^\p{L}\p{N} ]/gu, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
        content = [
          {
            type: 'tool_use',
            id: `demo_${++seq}`,
            name: 'search_products',
            input: { query: words.join(' ') || text || 'nouveautés', ...(size ? { size } : {}) },
          },
        ];
      }
    }
    return {
      content,
      stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      model: 'demo',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

function describe(json: string): string {
  const data = JSON.parse(json) as Partial<SearchResult> & {
    zones?: { label: string; fee: { amount: number } }[];
  };
  if (data.zones) {
    const zones = data.zones.map((z) => `${z.label} : ${formatXof(z.fee.amount)}`).join(', ');
    return `Nous livrons à ${zones}. Le retrait en boutique est aussi possible.`;
  }
  const results = data.results ?? [];
  if (results.length === 0)
    return 'Je n’ai pas trouvé cet article. Pouvez-vous le décrire autrement ?\nBoutons: Voir les nouveautés';
  const first = results[0] as SearchResult['results'][number];
  const inStock = first.variants
    .filter((v) => v.available > 0)
    .map((v) => Object.values(v.options).join(' '));
  const stock =
    inStock.length > 0
      ? `Disponible en ${inStock.join(', ')}.`
      : 'Il est en rupture pour le moment.';
  return `${first.title} : ${formatXof(first.price.amount)}. ${stock}\nBoutons: Commander | Autres modèles`;
}
