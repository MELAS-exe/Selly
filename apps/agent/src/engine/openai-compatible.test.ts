import { describe, expect, it } from 'vitest';
import { FallbackProvider, type LlmRequest } from './llm';
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
    expect(retryAfterMs(new Response(''), 'Please try again in 340ms.')).toBe(590);
    expect(retryAfterMs(new Response(''), 'nothing')).toBe(5000);
  });

  it('is chosen by name, and asks for its key', () => {
    expect(openAiCompatibleFor('claude-opus-5-5')).toBeNull();
    expect(openAiCompatibleFor('ollama:qwen3:8b', {})?.name).toBe('ollama:qwen3:8b');
    expect(() => openAiCompatibleFor('groq:openai/gpt-oss-120b', {})).toThrow('GROQ_API_KEY');
  });
});

/** A provider whose server answers the given responses in order, and records each request body. */
function scripted(responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const provider = new OpenAiCompatibleProvider({
    name: 'groq:test',
    model: 'test',
    baseUrl: 'https://api.example/v1',
    apiKey: 'k',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const next = responses.shift();
      if (!next) throw new Error('no more scripted responses');
      return next;
    }) as typeof fetch,
  });
  return { provider, bodies };
}
const tooMany = (wait: string) =>
  new Response(`{"error":{"message":"Rate limit reached. Please try again in ${wait}."}}`, {
    status: 429,
  });
const answer = (message: Record<string, unknown>, finish = 'stop') =>
  Response.json({
    choices: [{ finish_reason: finish, message }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });

describe('OpenAI-compatible provider: failures', () => {
  it('sends the tools and the conversation on every attempt', async () => {
    const { provider, bodies } = scripted([tooMany('0.01s'), answer({ content: 'Bonjour' })]);
    await provider.complete(req());
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0]).toMatchObject({
      model: 'test',
      tools: [{ type: 'function', function: { name: 'search_products' } }],
    });
  });

  it('reports the provider’s own message when the wait is too long (daily limit)', async () => {
    const { provider } = scripted([tooMany('12m30s')]);
    await expect(provider.complete(req())).rejects.toThrow(/HTTP 429 .*try again in 12m30s/);
  });

  it('fails at once when the wait would pass the turn deadline, so the fallback has time', async () => {
    const { provider, bodies } = scripted([tooMany('5s')]);
    const started = Date.now();
    await expect(provider.complete(req({ deadlineAt: Date.now() + 4_000 }))).rejects.toThrow(
      /HTTP 429/,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(bodies).toHaveLength(1);
  });

  it('stops after the retries, with the last 429', async () => {
    const { provider, bodies } = scripted([1, 2, 3, 4, 5].map(() => tooMany('0.01s')));
    await expect(provider.complete(req())).rejects.toThrow(/HTTP 429/);
    expect(bodies).toHaveLength(5); // the first try and 4 retries
  });

  it('stops waiting when the turn is aborted', async () => {
    const { provider } = scripted([tooMany('20s')]);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(new Error('turn deadline')), 50);
    await expect(provider.complete(req({ signal: ctrl.signal }))).rejects.toThrow('turn deadline');
  });

  it('treats an answer with no choices as an error, not an empty reply', async () => {
    const { provider } = scripted([Response.json({ choices: [] })]);
    await expect(provider.complete(req())).rejects.toThrow('no choices');
  });

  it('refuses malformed or cut-off tool arguments instead of running the tool with {}', async () => {
    const call = (args: unknown) => ({
      content: null,
      tool_calls: [{ id: 'c', function: { name: 'get_product', arguments: args } }],
    });
    for (const args of ['{"product_id": ', '[1,2]', 'null', '"text"']) {
      const { provider } = scripted([answer(call(args), 'tool_calls')]);
      await expect(provider.complete(req()), String(args)).rejects.toThrow(/arguments/);
    }
    const cut = scripted([answer(call('{"product_id":"p1"}'), 'length')]);
    await expect(cut.provider.complete(req())).rejects.toThrow('cut off');
    // Some servers send the arguments as an object: accepted.
    const obj = scripted([answer(call({ product_id: 'p1' }), 'tool_calls')]);
    expect((await obj.provider.complete(req())).content).toEqual([
      { type: 'tool_use', id: 'c', name: 'get_product', input: { product_id: 'p1' } },
    ]);
  });

  it('lets the fallback provider answer when it fails', async () => {
    const { provider } = scripted([Response.json({ choices: [] })]);
    const fallback = {
      name: 'demo',
      complete: async () => ({
        content: [{ type: 'text' as const, text: 'Réponse de secours' }],
        stopReason: 'end_turn' as const,
        model: 'demo',
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };
    const res = await new FallbackProvider(provider, fallback).complete(req());
    expect(res.content).toEqual([{ type: 'text', text: 'Réponse de secours' }]);
  });
});
