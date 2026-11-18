// Runs the evaluation set against a model (architecture.md section 12.4).
//
//   pnpm --filter @selly/agent eval                       # every case, LLM_PRIMARY or claude-opus-5-5
//   pnpm --filter @selly/agent eval -- --limit 10         # the first 10 cases
//   pnpm --filter @selly/agent eval -- --only wo-,mix-    # cases whose id starts with one of these
//   pnpm --filter @selly/agent eval -- --model claude-sonnet-5-5 --concurrency 4
//
// Each case gets a fresh agent on the fake core's demo shop, so results never depend on order.
// Every run spends real API money: start with --limit. Results go to eval/results/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, providerFor } from '../src/app';
import { FAKE_VENDOR_ID, FakeCore } from '../src/core/fake';
import type { LlmProvider, LlmRequest, LlmResponse } from '../src/engine/llm';
import { MemoryStore } from '../src/store/memory';
import { CASES, type EvalCase } from './cases';
import {
  type CallUsage,
  callCostUsd,
  type Grade,
  grade,
  PRICES,
  percentile,
  type TurnObservation,
} from './grade';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Records the usage of every call, for the cost per reply. */
/**
 * Keeps calls under a tokens-per-minute budget (Groq's free plan: 8,000 per model), by waiting before a
 * call rather than meeting a 429 in the middle of a turn. Shared by every case of a run.
 */
export class Pacer {
  private readonly spent: { at: number; tokens: number }[] = [];
  constructor(private readonly tokensPerMinute: number) {}
  async take(tokens: number) {
    if (!Number.isFinite(this.tokensPerMinute) || this.tokensPerMinute <= 0) return;
    for (;;) {
      const now = Date.now();
      while (this.spent[0] && now - this.spent[0].at >= 60_000) this.spent.shift();
      const used = this.spent.reduce((sum, x) => sum + x.tokens, 0);
      if (used + tokens <= this.tokensPerMinute || this.spent.length === 0) {
        this.spent.push({ at: now, tokens });
        return;
      }
      await new Promise((r) => setTimeout(r, 60_000 - (now - (this.spent[0]?.at ?? now)) + 50));
    }
  }
  /** Corrects the estimate with the real count once the call has answered. */
  settle(estimate: number, actual: number) {
    const last = this.spent.findLast((x) => x.tokens === estimate);
    if (last) last.tokens = actual;
  }
}

/** Rough size of a request in tokens (about 4 characters per token), for the pacer. */
const estimateTokens = (req: LlmRequest) =>
  Math.ceil(JSON.stringify([req.system, req.messages, req.tools ?? []]).length / 4) +
  req.maxTokens / 4;

/** Records the usage and the duration of every call, for the cost and the latency per reply. */
class RecordingProvider implements LlmProvider {
  readonly name: string;
  readonly calls: (CallUsage & { purpose: string; ms: number })[] = [];
  constructor(
    private readonly inner: LlmProvider,
    private readonly pacer?: Pacer,
  ) {
    this.name = inner.name;
  }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const estimate = Math.round(estimateTokens(req));
    await this.pacer?.take(estimate);
    const started = Date.now();
    const res = await this.inner.complete(req);
    this.pacer?.settle(estimate, res.usage.inputTokens + res.usage.outputTokens);
    this.calls.push({
      ms: Date.now() - started,
      purpose: req.purpose,
      model: res.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      cacheReadTokens: res.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: res.usage.cacheWriteTokens ?? 0,
    });
    return res;
  }
}

interface CaseResult {
  id: string;
  lang: string;
  intent: string;
  wolofToCheck: boolean;
  turns: number;
  observation: TurnObservation;
  grade: Grade;
  costUsd: number | null;
  tokens: { input: number; output: number };
  error?: string;
}

export async function runCase(
  c: EvalCase,
  makeProvider: () => LlmProvider,
  pacer?: Pacer,
  /** Turn deadline: longer for paced (rate-limited) and local models, whose latency is measured anyway. */
  turnDeadlineMs = pacer ? 180_000 : 12_000,
): Promise<CaseResult> {
  const provider = new RecordingProvider(makeProvider(), pacer);
  const store = new MemoryStore();
  const app = buildApp({
    store,
    core: new FakeCore('https://app.selly.example'),
    llm: provider,
    config: {
      appBaseUrl: 'https://app.selly.example',
      databaseUrl: '',
      coreUrl: '',
      mergeWindowMs: 0,
      // Pacing waits happen inside a turn: the deadline must allow them. Latency is measured on the calls.
      turnDeadlineMs,
      testEndpoint: true,
      serviceToken: 'eval-service-token',
    },
  });
  const role = c.role ?? 'customer';
  let conversationRef: string | undefined;
  let last: {
    reply: { text: string; conversation_id: string };
    tool_calls: TurnObservation['toolCalls'];
    usage: { latency_ms: number };
  } | null = null;
  try {
    for (const text of c.turns) {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/v1/agent/chat',
        headers: { authorization: 'Bearer eval-service-token' },
        payload: {
          vendor_id: FAKE_VENDOR_ID,
          role,
          message_text: text,
          ...(conversationRef ? { conversation_ref: conversationRef } : {}),
        },
      });
      if (res.statusCode !== 200) {
        // A turn refused because the chat went to the vendor (human mode) ends the case there.
        if (last && res.json().detail?.includes('mode')) break;
        throw new Error(`turn answered ${res.statusCode}: ${res.body.slice(0, 200)}`);
      }
      last = res.json();
      conversationRef = last?.reply.conversation_id;
    }
    const conv = conversationRef ? await store.getConversation(conversationRef) : null;
    const observation: TurnObservation = {
      reply: last?.reply.text ?? '',
      toolCalls: last?.tool_calls ?? [],
      mode: conv?.mode ?? 'bot',
      // Time spent in model calls during the graded turn's case, per turn: pacing waits excluded.
      latencyMs: Math.round(
        provider.calls.reduce((sum, x) => sum + x.ms, 0) / Math.max(1, c.turns.length),
      ),
    };
    const costs = provider.calls.map(callCostUsd);
    return {
      id: c.id,
      lang: c.lang,
      intent: c.intent,
      wolofToCheck: Boolean(c.wolofToCheck),
      turns: c.turns.length,
      observation,
      grade: grade(c, observation),
      costUsd: costs.some((x) => x === null)
        ? null
        : costs.reduce<number>((s, x) => s + (x ?? 0), 0),
      tokens: {
        input: provider.calls.reduce((s, x) => s + x.inputTokens, 0),
        output: provider.calls.reduce((s, x) => s + x.outputTokens, 0),
      },
    };
  } catch (err) {
    const observation: TurnObservation = { reply: '', toolCalls: [], mode: 'bot', latencyMs: 0 };
    return {
      id: c.id,
      lang: c.lang,
      intent: c.intent,
      wolofToCheck: Boolean(c.wolofToCheck),
      turns: c.turns.length,
      observation,
      grade: {
        pass: false,
        tools: false,
        args: false,
        facts: false,
        handoff: false,
        language: false,
        problems: [String(err)],
      },
      costUsd: null,
      tokens: { input: 0, output: 0 },
      error: String(err),
    };
  } finally {
    await app.close();
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
        process.stdout.write('.');
      }
    }),
  );
  process.stdout.write('\n');
  return out;
}

export function summarise(results: CaseResult[], model: string, eurPerUsd: number) {
  const rate = (f: (r: CaseResult) => boolean) =>
    results.length ? Math.round((100 * results.filter(f).length) / results.length) : 0;
  const turns = results.reduce((s, r) => s + r.turns, 0);
  const costs = results.map((r) => r.costUsd).filter((x): x is number => x !== null);
  const totalUsd = costs.reduce((s, x) => s + x, 0);
  const perReplyUsd = costs.length
    ? totalUsd / results.filter((r) => r.costUsd !== null).reduce((s, r) => s + r.turns, 0)
    : null;
  const latencies = results.map((r) => r.observation.latencyMs).filter((x) => x > 0);
  const byLang = Object.fromEntries(
    ['fr', 'en', 'wo', 'mixed'].map((l) => {
      const rs = results.filter((r) => r.lang === l);
      return [
        l,
        {
          cases: rs.length,
          pass: rs.length
            ? Math.round((100 * rs.filter((r) => r.grade.pass).length) / rs.length)
            : null,
        },
      ];
    }),
  );
  return {
    model,
    cases: results.length,
    turns,
    pass: rate((r) => r.grade.pass),
    tools: rate((r) => r.grade.tools),
    args: rate((r) => r.grade.args),
    facts: rate((r) => r.grade.facts),
    handoff: rate((r) => r.grade.handoff),
    language: rate((r) => r.grade.language),
    errors: results.filter((r) => r.error).length,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    costUsd: { total: totalUsd, perReply: perReplyUsd },
    costEurPerReply: perReplyUsd === null ? null : perReplyUsd * eurPerUsd,
    tokensPerReply: {
      input: Math.round(results.reduce((s, r) => s + r.tokens.input, 0) / Math.max(1, turns)),
      output: Math.round(results.reduce((s, r) => s + r.tokens.output, 0) / Math.max(1, turns)),
    },
    eurPerUsd,
    byLang,
  };
}

function markdown(s: ReturnType<typeof summarise>, results: CaseResult[]): string {
  const lines = [
    `# Agent evaluation: ${s.model}`,
    '',
    `${s.cases} cases, ${s.turns} turns. Pass ${s.pass} %.`,
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Correct tools | ${s.tools} % |`,
    `| Correct arguments | ${s.args} % |`,
    `| Facts (prices, stock, fees) | ${s.facts} % |`,
    `| Handoff when expected | ${s.handoff} % |`,
    `| Reply language | ${s.language} % |`,
    `| Latency per turn p50 / p95 | ${s.latencyMs.p50} / ${s.latencyMs.p95} ms |`,
    `| Cost per reply | ${s.costUsd.perReply === null ? 'unknown model price' : `${s.costUsd.perReply.toFixed(5)} USD, about ${(s.costEurPerReply ?? 0).toFixed(5)} EUR (at ${s.eurPerUsd} EUR per USD)`} |`,
    `| Tokens per reply (input / output) | ${s.tokensPerReply.input} / ${s.tokensPerReply.output} |`,
    `| Errors | ${s.errors} |`,
    '',
    'Plan limits assume about 0.004 EUR per reply (architecture.md section 8.7).',
    '',
    '| Language | Cases | Pass |',
    '| --- | --- | --- |',
    ...Object.entries(s.byLang).map(([l, v]) => `| ${l} | ${v.cases} | ${v.pass ?? '-'} % |`),
    '',
    'Wolof and mixed cases were written by a non-native speaker: check them before trusting those scores.',
    '',
    '## Failures',
    '',
    ...results
      .filter((r) => !r.grade.pass)
      .map(
        (r) =>
          `- **${r.id}** (${r.intent}): ${r.grade.problems.join('; ')}. Reply: « ${r.observation.reply.slice(0, 160).replaceAll('\n', ' ')} »`,
      ),
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  // Request logs would drown the progress line; the report has what matters.
  process.env.NODE_ENV = 'test';
  // --model, else LLM_PRIMARY when it names a real model (claude-…, groq:…, ollama:…, openai:…).
  const fromEnv = process.env.LLM_PRIMARY ?? '';
  const model =
    arg('model') ??
    (/^(claude-|groq:|ollama:|openai:)/.test(fromEnv) ? fromEnv : 'claude-opus-5-5');
  providerFor(model); // fails now, with a clear message, on an unknown name or a missing key
  const limit = Number(arg('limit') ?? CASES.length);
  const only = arg('only')?.split(',').filter(Boolean);
  const concurrency = Number(arg('concurrency') ?? 4);
  // Tokens per minute: Groq's free plan allows 8,000 per model, so 7,000 leaves a margin.
  const tpm = Number(arg('tpm') ?? process.env.EVAL_TPM ?? (model.startsWith('groq:') ? 7000 : 0));
  const pacer = tpm > 0 ? new Pacer(tpm) : undefined;
  // Prices for a model the table does not know (USD per million tokens), e.g. a Groq model.
  const priceIn = arg('price-in');
  const priceOut = arg('price-out');
  if (priceIn && priceOut)
    PRICES[model] = {
      input: Number(priceIn),
      output: Number(priceOut),
      cacheRead: Number(priceIn) / 2,
    };
  const eurPerUsd = Number(process.env.EUR_PER_USD ?? 0.9);
  const cases = CASES.filter((c) => !only || only.some((p) => c.id.startsWith(p))).slice(0, limit);

  console.log(`Evaluating ${cases.length} cases on ${model} (concurrency ${concurrency})`);
  if (pacer) console.log(`Pacing at ${tpm} tokens per minute.`);
  const results = await pool(cases, concurrency, (c) =>
    runCase(
      c,
      () => providerFor(model),
      pacer,
      pacer || model.startsWith('ollama:') ? 180_000 : 12_000,
    ),
  );
  const summary = summarise(results, model, eurPerUsd);

  const dir = join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = join(dir, `${stamp}-${model.replace(/[^A-Za-z0-9._-]+/g, '_')}`);
  writeFileSync(`${base}.json`, JSON.stringify({ summary, results }, null, 2));
  writeFileSync(`${base}.md`, markdown(summary, results));
  console.log(markdown(summary, results).split('## Failures')[0]);
  console.log(`Report: ${base}.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
