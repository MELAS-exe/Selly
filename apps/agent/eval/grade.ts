// Grading of one evaluated turn (architecture.md section 12.4). Pure functions, unit tested.

import type { EvalCase } from './cases';

export interface TurnObservation {
  reply: string;
  toolCalls: { name: string; arguments: Record<string, unknown>; ok: boolean }[];
  mode: 'bot' | 'human' | 'paused';
  latencyMs: number;
}

export interface Grade {
  pass: boolean;
  tools: boolean;
  args: boolean;
  facts: boolean;
  handoff: boolean;
  language: boolean;
  problems: string[];
}

/** Lower case, no accents, every kind of space (narrow no-break included) as one space, no thousands dots. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/(\d)[.,   ](?=\d{3}\b)/g, '$1 ')
    .replace(/[\s  ]+/g, ' ')
    .trim();
}

const contains = (haystack: string, needle: string) =>
  normalise(haystack).includes(normalise(needle));

/** Does `actual` contain every key of `expected` with an equal value (deeply, partially)? */
export function partialMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    if (typeof expected === 'string' && typeof actual === 'string')
      return normalise(actual) === normalise(expected);
    return actual === expected;
  }
  if (typeof actual !== 'object' || actual === null) return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    partialMatch((actual as Record<string, unknown>)[k], v),
  );
}

const FR =
  /\b(le|la|les|est|vous|pour|avec|une|des|du|nous|votre|oui|bonjour|merci|il|elle|sont|pas)\b/g;
const EN = /\b(the|is|you|for|with|and|we|our|are|yes|hello|thank|it|this|not|your|can)\b/g;

/** A rough guess of the reply's language from common words: enough to catch a reply in the wrong one. */
export function guessLanguage(text: string): 'fr' | 'en' | 'unknown' {
  const t = normalise(text);
  const fr = (t.match(FR) ?? []).length;
  const en = (t.match(EN) ?? []).length;
  if (fr === 0 && en === 0) return 'unknown';
  return fr >= en ? 'fr' : 'en';
}

export function grade(c: EvalCase, o: TurnObservation): Grade {
  const problems: string[] = [];
  const called = o.toolCalls.map((t) => t.name);

  let tools = true;
  for (const t of c.tools)
    if (!called.includes(t)) {
      tools = false;
      problems.push(`missing tool ${t}`);
    }
  for (const t of c.forbiddenTools ?? [])
    if (called.includes(t)) {
      tools = false;
      problems.push(`forbidden tool ${t}`);
    }
  for (const t of c.succeeded ?? [])
    if (!o.toolCalls.some((x) => x.name === t && x.ok)) {
      tools = false;
      problems.push(`${t} did not succeed`);
    }
  if (c.noTools && called.length > 0) {
    tools = false;
    problems.push(`no tool expected, got ${called.join(', ')}`);
  }

  let args = true;
  for (const [name, expected] of Object.entries(c.args ?? {})) {
    const calls = o.toolCalls.filter((t) => t.name === name);
    if (!calls.some((t) => partialMatch(t.arguments, expected))) {
      args = false;
      problems.push(
        `arguments of ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(calls.map((t) => t.arguments))}`,
      );
    }
  }

  let facts = true;
  for (const need of c.mustInclude ?? []) {
    const options = Array.isArray(need) ? need : [need];
    if (!options.some((n) => contains(o.reply, n))) {
      facts = false;
      problems.push(`reply lacks ${options.map((x) => `« ${x} »`).join(' or ')}`);
    }
  }
  for (const bad of c.mustNotInclude ?? [])
    if (contains(o.reply, bad)) {
      facts = false;
      problems.push(`reply contains « ${bad} »`);
    }

  const handoff = c.handoff ? o.mode === 'human' : true;
  if (!handoff) problems.push('expected a handoff (human mode)');

  let language = true;
  if (c.replyLang) {
    const got = guessLanguage(o.reply);
    if (got !== 'unknown' && got !== c.replyLang) {
      language = false;
      problems.push(`reply in ${got}, expected ${c.replyLang}`);
    }
  }

  return {
    pass: tools && args && facts && handoff && language,
    tools,
    args,
    facts,
    handoff,
    language,
    problems,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] as number;
}

/** USD per million tokens. Cache writes cost 1.25 × input. Update from the pricing page when it changes. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // A local model has no price per token (the machine and its power are the cost).
  'ollama:': { input: 0, output: 0, cacheRead: 0 },
};

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Cost in USD of one model call; `inputTokens` counts every input token, cached ones included. */
export function callCostUsd(u: CallUsage): number | null {
  const price = PRICES[u.model] ?? Object.entries(PRICES).find(([k]) => u.model.startsWith(k))?.[1];
  if (!price) return null;
  const uncached = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
  return (
    (uncached * price.input +
      u.cacheWriteTokens * price.input * 1.25 +
      u.cacheReadTokens * price.cacheRead +
      u.outputTokens * price.output) /
    1_000_000
  );
}
