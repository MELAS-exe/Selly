// Any OpenAI-compatible chat completions API behind LlmProvider (architecture.md section 8.7): Groq, Ollama, and
// others. One call per tool round, like the Claude provider; the engine runs the loop.
//
//   LLM_PRIMARY=groq:openai/gpt-oss-120b      GROQ_API_KEY
//   LLM_PRIMARY=ollama:qwen3:8b               OLLAMA_BASE_URL (default http://localhost:11434/v1)
//   LLM_PRIMARY=openai:<model>                OPENAI_BASE_URL, OPENAI_API_KEY
//
// Photo extraction sends images and asks for JSON (response_format). Keep it on a model that takes images: gpt-oss
// does not, and Ollama's OpenAI endpoint takes inline images only. On a free tier, raise AGENT_TURN_DEADLINE_MS:
// a rate-limit wait longer than what is left of the turn fails the call at once.
import type { LlmBlock, LlmProvider, LlmRequest, LlmResponse } from './llm';

export interface OpenAiCompatibleOptions {
  /** Shown in logs and stored with each call, e.g. "groq:openai/gpt-oss-120b". */
  name: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string | ChatPart[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };
type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const MAX_RATE_LIMIT_RETRIES = 4;
/** Longer than this, the turn gives up (the engine then hands off) rather than keep the customer waiting. */
const MAX_RATE_LIMIT_WAIT_MS = 25_000;
/** Time kept for the call itself after a rate-limit wait. */
const CALL_MARGIN_MS = 3_000;
/** For a call made without a caller's signal. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Tool arguments as an object. Most servers send a JSON string, some an object. Anything that is not a JSON object
 * fails the call: running a tool with made-up empty arguments is worse than retrying the turn.
 */
export function toolInput(
  provider: string,
  call: { function: { name: string; arguments: unknown } },
) {
  let v = call.function.arguments;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v || '{}');
    } catch {
      throw new Error(`${provider}: malformed arguments for tool ${call.function.name}`);
    }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error(`${provider}: arguments for tool ${call.function.name} are not an object`);
  return v as Record<string, unknown>;
}

/** The wait a 429 asks for: Retry-After, or Groq's "try again in 18.5s", else 5 s. */
export function retryAfterMs(res: Response, body: string): number {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);
  const ms = /try again in ([\d.]+)ms/i.exec(body);
  if (ms) return Math.ceil(Number(ms[1])) + 250;
  const m = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(body);
  if (m) return Math.ceil((Number(m[1] ?? 0) * 60 + Number(m[2])) * 1000) + 250;
  return 5_000;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** The engine's messages in the chat completions shape: tool results become `tool` messages. */
export function toChatMessages(req: LlmRequest): ChatMessage[] {
  const system = [req.system.stable, req.system.dynamic].filter(Boolean).join('\n\n');
  const out: ChatMessage[] = [{ role: 'system', content: system }];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Extract<LlmBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const calls = m.content.filter(
        (b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use',
      );
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
      continue;
    }
    const parts: ChatPart[] = [];
    for (const b of m.content) {
      if (b.type === 'tool_result')
        out.push({
          role: 'tool',
          tool_call_id: b.toolUseId,
          content: b.isError ? `ERROR: ${b.content}` : b.content,
        });
      else if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image')
        parts.push({
          type: 'image_url',
          image_url: { url: b.base64 ? `data:${b.mediaType};base64,${b.base64}` : (b.url ?? '') },
        });
    }
    if (parts.length > 0)
      out.push({
        role: 'user',
        content: parts.every((p) => p.type === 'text')
          ? parts.map((p) => (p as { text: string }).text).join('\n')
          : parts,
      });
  }
  return out;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.name = opts.name;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: this.opts.model,
      max_tokens: req.maxTokens,
      messages: toChatMessages(req),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
      ...(req.jsonSchema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'output', schema: req.jsonSchema },
            },
          }
        : {}),
    };
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
    // Without a caller's signal (some extractions), a stalled provider must still give up.
    const signal = req.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const deadlineAt = req.deadlineAt ?? (req.signal ? undefined : Date.now() + DEFAULT_TIMEOUT_MS);
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    };
    // Free tiers (Groq: 8,000 tokens per minute) answer 429 with the wait they want. Wait and retry only when the
    // wait fits before the deadline (with a margin for the call itself); otherwise fail now, with the provider's
    // message, so the fallback provider still has time. The body of each response is read once.
    let res = await this.fetchImpl(url, init);
    let errorBody: string | null = null;
    for (let attempt = 0; res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES; attempt++) {
      errorBody = await res.text();
      const waitMs = retryAfterMs(res, errorBody);
      const left = deadlineAt === undefined ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
      if (waitMs > MAX_RATE_LIMIT_WAIT_MS || waitMs + CALL_MARGIN_MS > left) break;
      await sleep(waitMs, signal);
      res = await this.fetchImpl(url, init);
      errorBody = null;
    }
    if (!res.ok) {
      const detail = (errorBody ?? (await res.text())).slice(0, 300);
      throw new Error(`${this.name}: HTTP ${res.status} ${detail}`);
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: {
        finish_reason?: string;
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: unknown } }[];
        };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    // No answer is an error, not an empty reply: the engine would send nothing and the fallback would never run.
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error(`${this.name}: the response has no choices`);
    const finish = choice.finish_reason;
    const calls = choice.message.tool_calls ?? [];
    // A tool call cut off by the length limit has partial arguments: never run it.
    if (finish === 'length' && calls.length > 0)
      throw new Error(`${this.name}: a tool call was cut off by the length limit`);
    const content: LlmBlock[] = [];
    if (choice.message.content) content.push({ type: 'text', text: choice.message.content });
    for (const c of calls)
      content.push({
        type: 'tool_use',
        id: c.id,
        name: c.function.name,
        input: toolInput(this.name, c),
      });
    return {
      content,
      stopReason:
        finish === 'tool_calls'
          ? 'tool_use'
          : finish === 'stop'
            ? 'end_turn'
            : finish === 'length'
              ? 'max_tokens'
              : finish === 'content_filter'
                ? 'refusal'
                : content.some((b) => b.type === 'tool_use')
                  ? 'tool_use'
                  : 'end_turn',
      model: data.model ?? this.opts.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** `groq:<model>`, `ollama:<model>` or `openai:<model>`, or null for another name. */
export function openAiCompatibleFor(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): OpenAiCompatibleProvider | null {
  const m = /^(groq|ollama|openai):(.+)$/.exec(name);
  if (!m) return null;
  const [, kind, model] = m as unknown as [string, 'groq' | 'ollama' | 'openai', string];
  if (kind === 'groq') {
    if (!env.GROQ_API_KEY) throw new Error(`${name} needs GROQ_API_KEY.`);
    return new OpenAiCompatibleProvider({
      name,
      model,
      baseUrl: env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      apiKey: env.GROQ_API_KEY,
    });
  }
  if (kind === 'ollama')
    return new OpenAiCompatibleProvider({
      name,
      model,
      baseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    });
  if (!env.OPENAI_BASE_URL) throw new Error(`${name} needs OPENAI_BASE_URL.`);
  return new OpenAiCompatibleProvider({
    name,
    model,
    baseUrl: env.OPENAI_BASE_URL,
    ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
  });
}
