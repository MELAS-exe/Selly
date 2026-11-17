// Provider-agnostic LLM interface (ADR-11, architecture.md section 8.7).
// The engine owns the tool loop; a provider makes one model call.

export type LlmBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      url?: string;
      base64?: string;
    }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmBlock[];
  /**
   * The provider's own content for an assistant turn (for Claude: thinking blocks included),
   * echoed back unchanged on the next call of the same tool loop.
   */
  providerContent?: unknown;
}

export interface LlmToolDef {
  name: string;
  description: string;
  /** JSON Schema of the input, `type: "object"`. */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  purpose: 'reply' | 'summary' | 'extraction';
  /** Stable part of the system prompt first: it is cached. */
  system: { stable: string; dynamic: string };
  messages: LlmMessage[];
  tools?: LlmToolDef[];
  /** When set, the reply text is JSON matching this schema (structured output). */
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * When `signal` aborts (epoch ms). A provider that would wait past it (a rate-limit retry) fails at once instead,
   * so the fallback provider still has time to answer.
   */
  deadlineAt?: number;
}

export interface LlmResponse {
  content: LlmBlock[];
  providerContent?: unknown;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  model: string;
  /** `inputTokens` counts every input token; the cache fields say how many of them were cached. */
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** Tries the primary provider, then the fallback once (section 7.5, LLM provider row). */
export class FallbackProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private readonly primary: LlmProvider,
    private readonly fallback: LlmProvider,
  ) {
    this.name = `${primary.name}|${fallback.name}`;
  }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    try {
      return await this.primary.complete(req);
    } catch (err) {
      if (req.signal?.aborted) throw err;
      // The fallback cannot read the primary's provider-specific content.
      const messages = req.messages.map(({ providerContent: _, ...m }) => m);
      return this.fallback.complete({ ...req, messages });
    }
  }
}

export const textOf = (blocks: LlmBlock[]) =>
  blocks
    .filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
