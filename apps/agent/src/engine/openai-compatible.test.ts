import { describe, expect, it } from 'vitest';
import type { LlmRequest } from './llm';
import {
  OpenAiCompatibleProvider,
  openAiCompatibleFor,
  retryAfterMs,
  toChatMessages,
} from './openai-compatible';

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  purpose: 'reply',
  system: { stable: 'Tu es l’assistant.', dynamic: 'Boutique: Awa Style' },
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Robe noire en 42 ?' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_1', name: 'search_products', input: { query: 'robe noire' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'call_1', content: '{"results":[]}' }],
    },
  ],
  tools: [
    {
      name: 'search_products',
      description: 'Cherche',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  maxTokens: 500,
  ...over,
});

describe('OpenAI-compatible provider', () => {
  it('turns the engine’s messages into chat completions messages, tool results as tool messages', () => {
    expect(toChatMessages(req())).toEqual([
      { role: 'system', content: 'Tu es l’assistant.\n\nBoutique: Awa Style' },
      { role: 'user', content: 'Robe noire en 42 ?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_products', arguments: '{"query":"robe noire"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"results":[]}' },
    ]);
  });

  it('reads tool calls back, and waits and retries on a 429', async () => {
    const calls: unknown[] = [];
    const replies = [
      new Response('{"error":{"message":"Rate limit reached. Please try again in 0.05s."}}', {
        status: 429,
      }),
      Response.json({
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                { id: 'c2', function: { name: 'get_product', arguments: '{"product_id":"p1"}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 2800, completion_tokens: 40 },
      }),
    ];
    const p = new OpenAiCompatibleProvider({
      name: 'groq:openai/gpt-oss-120b',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.example/v1',
      apiKey: 'k',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        calls.push(JSON.parse(String(init.body)));
        return replies.shift() as Response;
      }) as typeof fetch,
    });
    const res = await p.complete(req());
    expect(calls).toHaveLength(2);
    expect(res).toMatchObject({
      stopReason: 'tool_use',
      content: [{ type: 'tool_use', id: 'c2', name: 'get_product', input: { product_id: 'p1' } }],
      usage: { inputTokens: 2800, outputTokens: 40 },
    });
  });

  it('parses the wait a 429 asks for', () => {
    expect(retryAfterMs(new Response('', { headers: { 'retry-after': '3' } }), '')).toBe(3000);
    expect(retryAfterMs(new Response(''), 'Please try again in 18.5s.')).toBe(18_750);
    expect(retryAfterMs(new Response(''), 'try again in 1m2s')).toBe(62_250);
    expect(retryAfterMs(new Response(''), 'nothing')).toBe(5000);
  });

  it('is chosen by name, and asks for its key', () => {
    expect(openAiCompatibleFor('claude-opus-5-5')).toBeNull();
    expect(openAiCompatibleFor('ollama:qwen3:8b', {})?.name).toBe('ollama:qwen3:8b');
    expect(() => openAiCompatibleFor('groq:openai/gpt-oss-120b', {})).toThrow('GROQ_API_KEY');
  });
});
