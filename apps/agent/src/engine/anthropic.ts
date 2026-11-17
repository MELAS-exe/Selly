// Claude provider for the LlmProvider interface (architecture.md section 8.7).
// One Messages API call per tool round; the engine runs the loop, the deadline and the tool policy.

import Anthropic from '@anthropic-ai/sdk';
import type { LlmBlock, LlmProvider, LlmRequest, LlmResponse } from './llm';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeOptions {
  model: string;
  /** Chat replies must land in seconds (p50 4 s, section 10), so the default effort is low. */
  effort?: Effort;
  client?: Anthropic;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class ClaudeProvider implements LlmProvider {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;

  constructor(private readonly opts: ClaudeOptions) {
    this.name = opts.model;
    // The engine has its own deadline and one fallback, so one SDK retry is enough.
    this.client = opts.client ?? new Anthropic({ maxRetries: 1 });
    this.effort = opts.effort ?? 'low';
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const tools: Anthropic.Beta.BetaToolUnion[] = (req.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    // Prompt caching: tools and the stable system prompt form the cached prefix (section 8.7).
    const lastTool = tools.at(-1);
    if (lastTool && 'input_schema' in lastTool) lastTool.cache_control = { type: 'ephemeral' };

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } },
    ];
    if (req.system.dynamic) system.push({ type: 'text', text: req.system.dynamic });

    const response = await this.client.beta.messages.create(
      {
        model: this.opts.model,
        max_tokens: req.maxTokens,
        system,
        messages: req.messages.map(toParam),
        ...(tools.length > 0 ? { tools } : {}),
        output_config: {
          effort: this.effort,
          ...(req.jsonSchema ? { format: { type: 'json_schema', schema: req.jsonSchema } } : {}),
        },
        // Server-side fallback on a policy decline: the API reruns the request on the default fallback model.
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      { signal: req.signal },
    );

    const content: LlmBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use')
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
    }
    const stop = response.stop_reason;
    return {
      content,
      providerContent: response.content,
      stopReason:
        stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' || stop === 'refusal'
          ? stop
          : 'other',
      model: response.model,
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (response.usage.cache_read_input_tokens ?? 0) +
          (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

function toParam(m: LlmRequest['messages'][number]): Anthropic.Beta.BetaMessageParam {
  if (m.role === 'assistant' && m.providerContent) {
    // Echo the full assistant content (thinking blocks included) unchanged within the tool loop.
    return {
      role: 'assistant',
      content: m.providerContent as Anthropic.Beta.BetaContentBlockParam[],
    };
  }
  const content: Anthropic.Beta.BetaContentBlockParam[] = m.content.map((b) => {
    switch (b.type) {
      case 'text':
        return { type: 'text', text: b.text };
      case 'image':
        return b.base64
          ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.base64 } }
          : { type: 'image', source: { type: 'url', url: b.url ?? '' } };
      case 'tool_use':
        return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: b.toolUseId,
          content: b.content,
          ...(b.isError ? { is_error: true } : {}),
        };
    }
  });
  return { role: m.role, content };
}
