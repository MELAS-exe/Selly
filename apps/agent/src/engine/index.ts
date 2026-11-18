// The agent engine: one turn (architecture.md section 8.2, steps 5 to 8).
// It does not know the channel: it reads a conversation and returns an AgentReply (section 3.9).
// Entitlements, mode checks, storage and delivery are the caller's job (conversations/turns.ts).

import type { AgentReply } from '../channels/types';
import type { CoreClient } from '../core/client';
import type { AgentProfile } from '../core/types';
import type { AgentStore, Conversation, ConversationState, StoredMessage } from '../store/types';
import {
  type HandoffRequest,
  runTool,
  type ToolContext,
  type ToolOutcome,
  toolDefinitions,
} from '../tools';
import type { ProductExtractor } from '../vision';
import { extractQuickReplies, filterReply, unbackedAmounts, unbackedOrderNumbers } from './filter';
import { asksForHuman, claimsOrder, negotiates, totalsIn } from './intents';
import type { LlmBlock, LlmMessage, LlmProvider } from './llm';
import { textOf } from './llm';
import { SUMMARY_PROMPT, systemPrompt } from './prompt';

export const MAX_TOOL_ROUNDS = 4;
const HISTORY_MESSAGES = 8;

export interface EngineDeps {
  llm: LlmProvider;
  /** Cheaper tier for summaries (section 8.7). Defaults to llm. */
  summaryLlm?: LlmProvider;
  core: CoreClient;
  store: AgentStore;
  extractor: ProductExtractor;
  appBaseUrl: string;
  deadlineMs: number;
  now?: () => Date;
}

export interface TurnRequest {
  conversation: Conversation;
  profile: AgentProfile;
  /** Inbound messages merged into this turn, already stored. */
  inbound: StoredMessage[];
  /** Voice note transcripts by message id. */
  transcripts?: Record<string, string>;
  requestId: string;
  setBotMode: ToolContext['setBotMode'];
  reportDraftUsage: ToolContext['reportDraftUsage'];
}

export interface TurnResult {
  reply: AgentReply;
  toolCalls: Omit<ToolOutcome, 'result'>[];
  usage: { inputTokens: number; outputTokens: number; latencyMs: number };
  handoff?: HandoffRequest;
  state: ConversationState;
}

export class TurnTimeoutError extends Error {
  constructor() {
    super('agent turn deadline exceeded');
  }
}

export class AgentEngine {
  private readonly now: () => Date;
  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const started = Date.now();
    const { conversation: conv, profile } = req;
    const role = conv.role;
    const controller = new AbortController();
    const deadlineAt = Date.now() + this.deps.deadlineMs;
    const timer = setTimeout(() => controller.abort(new TurnTimeoutError()), this.deps.deadlineMs);

    const state: ConversationState = structuredClone(conv.state);
    const ctx: ToolContext = {
      core: this.deps.core,
      conversation: conv,
      profile,
      call: {
        actor: role === 'customer' ? `customer:${conv.id}` : `vendor:${conv.vendorId}`,
        requestId: req.requestId,
      },
      state,
      imageKeys: req.inbound.flatMap((m) => m.imageKeys),
      extractor: this.deps.extractor,
      setBotMode: req.setBotMode,
      reportDraftUsage: req.reportDraftUsage,
      out: { cards: [], quickReplies: [], amounts: new Set() },
    };

    const history = await this.deps.store.recentMessages(
      conv.id,
      HISTORY_MESSAGES + req.inbound.length,
    );
    const messages = toLlmMessages(history, req.transcripts ?? {});
    // Amounts already in the visible conversation may be repeated back: the person's own words, and
    // replies that passed this check in an earlier turn.
    const lastText = req.inbound.map((m) => req.transcripts?.[m.id] ?? m.text ?? '').join(' ');
    // A customer who bargains names a price: that price must not count as backed, or « d'accord pour
    // 10 000 » would pass the amounts check (seen on ollama:qwen2.5:7b).
    const negotiating = role === 'customer' && negotiates(lastText);
    const thisTurn = new Set(req.inbound.map((m) => m.id));
    for (const m of history) {
      if (negotiating && thisTurn.has(m.id)) continue;
      for (const n of numbersIn(req.transcripts?.[m.id] ?? m.text ?? '')) ctx.out.amounts.add(n);
    }
    // Order numbers the reply may name: orders of this chat, the ones tools return this turn (added
    // below), and the ones the person wrote. Any other is an order the model made up.
    const knownOrders = new Set<string>(Object.keys(conv.state.orders ?? {}));
    for (const m of history)
      if (m.direction === 'in')
        for (const w of (m.text ?? '').match(/\b[A-Z0-9]{4,8}\b/g) ?? []) knownOrders.add(w);

    // Delivery fees of the shop profile are server facts in the prompt: a reply may quote them.
    for (const z of profile.delivery.zones) ctx.out.amounts.add(z.fee.amount);
    // Small models answer in French whatever the rule says: name the language when it is English.
    const replyLanguage =
      role === 'customer' && profile.languages.includes('en') && looksEnglish(lastText)
        ? ('en' as const)
        : undefined;
    const system = systemPrompt(role, profile, conv, this.now(), replyLanguage, negotiating);
    // Totals the reply may state: the last quote's, and those tools return this turn (added below).
    const knownTotals = new Set<number>(
      conv.state.lastQuoteTotal ? [conv.state.lastQuoteTotal.amount] : [],
    );

    // A customer who asks for a person gets the vendor, decided by code: small models said « je passe la
    // main » without calling handoff_to_vendor, or kept selling.
    if (role === 'customer' && asksForHuman(lastText)) {
      clearTimeout(timer);
      return this.handoffResult(
        ctx,
        [],
        0,
        0,
        started,
        'customer_request',
        `Le client demande à parler au vendeur : « ${lastText.slice(0, 300)} »`,
      );
    }
    const tools = toolDefinitions(role);
    const toolCalls: Omit<ToolOutcome, 'result'>[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = '';
    let corrected = false;

    try {
      for (let round = 0; ; round++) {
        if (controller.signal.aborted) throw new TurnTimeoutError();
        const callStarted = Date.now();
        const res = await this.deps.llm.complete({
          purpose: 'reply',
          system,
          messages,
          tools,
          maxTokens: 2048,
          signal: controller.signal,
          deadlineAt,
        });
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
        const uses = res.content.filter(
          (b): b is Extract<LlmBlock, { type: 'tool_use' }> => b.type === 'tool_use',
        );
        await this.deps.store.recordLlmCall({
          conversationId: conv.id,
          vendorId: conv.vendorId,
          purpose: 'reply',
          model: res.model,
          latencyMs: Date.now() - callStarted,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          // Logs keep no customer phone number (section 9.1).
          toolCalls: uses.map((u) => ({ name: u.name, input: maskPhones(u.input) })),
          error: res.stopReason === 'refusal' ? 'refusal' : null,
        });

        if (res.stopReason === 'refusal') {
          return this.handoffResult(
            ctx,
            toolCalls,
            inputTokens,
            outputTokens,
            started,
            'unsure',
            'Le modèle a refusé de répondre.',
          );
        }

        messages.push({
          role: 'assistant',
          content: res.content,
          providerContent: res.providerContent,
        });

        if (uses.length === 0) {
          const text = textOf(res.content);
          const badAmounts = unbackedAmounts(text, ctx.out.amounts);
          const badOrders = unbackedOrderNumbers(text, knownOrders);
          // An order claimed without a number, or a total no quote gave, is made up as well.
          const created = toolCalls.some((t) => t.name === 'create_order' && t.ok);
          if (
            !created &&
            badOrders.length === 0 &&
            claimsOrder(text) &&
            ![...knownOrders].some((n) => text.includes(n))
          )
            badOrders.push('(sans numéro)');
          for (const n of totalsIn(text))
            if (!knownTotals.has(n) && !badAmounts.includes(n)) badAmounts.push(n);
          const bad = [...badAmounts.map(String), ...badOrders];
          if (bad.length > 0 && !corrected) {
            // Facts come from tools (section 8.4, P5): one chance to fix the reply.
            corrected = true;
            messages.push({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: badOrders.length
                    ? `[Contrôle automatique] Ta réponse annonce des commandes qui n'existent pas : ${badOrders.join(', ')}. Une commande n'existe qu'après un create_order réussi. Appelle l'outil ou réécris la réponse sans ce numéro.`
                    : `[Contrôle automatique] Ta réponse cite des montants qu'aucun outil n'a renvoyés : ${badAmounts.join(', ')}. Vérifie avec un outil ou réécris la réponse sans ces montants.`,
                },
              ],
            });
            continue;
          }
          if (bad.length > 0) {
            return this.handoffResult(
              ctx,
              toolCalls,
              inputTokens,
              outputTokens,
              started,
              'unsure',
              badOrders.length
                ? `Commande annoncée sans avoir été créée : ${badOrders.join(', ')}`
                : `Montants non vérifiés dans la réponse : ${badAmounts.join(', ')}`,
            );
          }
          // A reply that says the vendor takes over must really hand over: otherwise the customer waits
          // for a vendor nobody alerted (seen on ollama:qwen2.5:7b).
          if (role === 'customer' && !ctx.out.handoff && announcesHandoff(text))
            ctx.out.handoff = {
              reason: 'customer_request',
              summary:
                `L'assistant a annoncé un passage au vendeur. Dernier message : ${lastText}`.slice(
                  0,
                  500,
                ),
            };
          finalText = text;
          break;
        }

        if (round >= MAX_TOOL_ROUNDS) {
          return this.handoffResult(
            ctx,
            toolCalls,
            inputTokens,
            outputTokens,
            started,
            'unsure',
            'Trop d’appels d’outils pour un seul message.',
          );
        }

        // Run this round's tool calls in parallel and return all results in one user message.
        const outcomes = await Promise.all(uses.map((u) => runTool(role, u.name, u.input, ctx)));
        for (const o of outcomes) {
          toolCalls.push({ name: o.name, arguments: o.arguments, ok: o.ok });
          for (const m of o.result.matchAll(/"number":"([A-Z0-9]{3,12})"/g))
            knownOrders.add(m[1] as string);
          for (const m of o.result.matchAll(/"total":\{"amount":(\d+)/g))
            knownTotals.add(Number(m[1]));
        }
        const results: LlmBlock[] = outcomes.map((o, i) => ({
          type: 'tool_result',
          toolUseId: (uses[i] as { id: string }).id,
          content: o.result,
          ...(o.ok ? {} : { isError: true }),
        }));
        if (round + 1 >= MAX_TOOL_ROUNDS)
          results.push({
            type: 'text',
            text: '[Contrôle automatique] Dernier tour : réponds maintenant sans appeler d’outil.',
          });
        messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      if (controller.signal.aborted) throw new TurnTimeoutError();
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const { text: withoutButtons, quickReplies: proposed } = extractQuickReplies(finalText);
    const filterOpts = { appBaseUrl: this.deps.appBaseUrl, whatsappLink: profile.whatsapp_link };
    const text = filterReply(withoutButtons, filterOpts);
    // Button labels are seen by the customer too: a label the filter would change is dropped.
    const quickReplies = proposed.filter((q) => filterReply(q.label, filterOpts) === q.label);
    state.misunderstandings = ctx.out.handoff ? 0 : state.misunderstandings;
    state.turnsSinceSummary = (state.turnsSinceSummary ?? 0) + 1;
    return {
      reply: {
        text: text || 'Je transmets votre message au vendeur, il vous répond très vite.',
        cards: ctx.out.cards,
        quickReplies: (ctx.out.quickReplies.length > 0 ? ctx.out.quickReplies : quickReplies).slice(
          0,
          4,
        ),
      },
      toolCalls,
      usage: { inputTokens, outputTokens, latencyMs: Date.now() - started },
      handoff: ctx.out.handoff,
      state,
    };
  }

  private handoffResult(
    ctx: ToolContext,
    toolCalls: Omit<ToolOutcome, 'result'>[],
    inputTokens: number,
    outputTokens: number,
    started: number,
    reason: HandoffRequest['reason'],
    summary: string,
  ): TurnResult {
    return {
      reply: { text: FIXED_HANDOFF_REPLY, cards: [], quickReplies: [] },
      toolCalls,
      usage: { inputTokens, outputTokens, latencyMs: Date.now() - started },
      handoff: ctx.out.handoff ?? { reason, summary },
      state: ctx.state,
    };
  }

  /** Refreshes the conversation summary with the cheaper tier (section 8.2 step 9). Never throws. */
  async summarise(conv: Conversation): Promise<string | null> {
    const llm = this.deps.summaryLlm ?? this.deps.llm;
    try {
      const history = await this.deps.store.recentMessages(conv.id, 30);
      const transcript = history
        .filter((m) => m.text)
        .map((m) => `${m.author}: ${m.text}`)
        .join('\n');
      const res = await llm.complete({
        purpose: 'summary',
        system: { stable: SUMMARY_PROMPT, dynamic: '' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Résumé précédent : ${conv.summary || '(aucun)'}\n\n${transcript}`,
              },
            ],
          },
        ],
        maxTokens: 400,
        signal: AbortSignal.timeout(this.deps.deadlineMs),
        deadlineAt: Date.now() + this.deps.deadlineMs,
      });
      await this.deps.store.recordLlmCall({
        conversationId: conv.id,
        vendorId: conv.vendorId,
        purpose: 'summary',
        model: res.model,
        latencyMs: 0,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        toolCalls: null,
        error: null,
      });
      return textOf(res.content).slice(0, 1000) || null;
    } catch {
      return null;
    }
  }
}

export const FIXED_HANDOFF_REPLY =
  'Je transmets votre message au vendeur, il vous répond très vite.';

function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:[   .]\d{3})+|\d+/g)].map((m) =>
    Number(m[0].replace(/[   .]/g, '')),
  );
}

/** Stored messages to model messages: customer or vendor (inbound) → user, agent and vendor (outbound) → assistant. */
export function toLlmMessages(
  history: StoredMessage[],
  transcripts: Record<string, string>,
): LlmMessage[] {
  const out: LlmMessage[] = [];
  const push = (role: 'user' | 'assistant', text: string) => {
    const last = out.at(-1);
    if (last && last.role === role) last.content.push({ type: 'text', text });
    else out.push({ role, content: [{ type: 'text', text }] });
  };
  for (const m of history) {
    let text = transcripts[m.id] ?? m.text ?? '';
    if (m.kind === 'audio' && transcripts[m.id]) text = `[Vocal transcrit] ${text}`;
    if (m.imageKeys.length > 0) text = `${text}\n[${m.imageKeys.length} photo(s) jointe(s)]`.trim();
    if (m.direction === 'in') {
      if (!text) continue;
      push('user', text);
    } else if (m.author === 'agent') {
      if (text) push('assistant', text);
    } else if (m.author === 'vendor') {
      push('assistant', `[Message écrit par le vendeur lui-même] ${text}`);
    } else if (m.author === 'system' && text) {
      push('user', `[Information système, pas un message du client] ${text}`);
    }
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

/** « +221 77 *** ** 67 »: keeps the country code and the last two digits of any phone-like value. */
export function maskPhones<T>(value: T): T {
  const json = JSON.stringify(value).replace(/\+?\d[\d .-]{6,}\d/g, (m) => {
    const d = m.replace(/\D/g, '');
    if (d.length < 8) return m;
    return `${m.startsWith('+') ? `+${d.slice(0, 3)} ` : ''}*** ** ${d.slice(-2)}`;
  });
  return JSON.parse(json) as T;
}

const HANDOFF_PHRASES = [
  /\bje\s+(?:vous\s+)?(?:passe|transmets|transf[eè]re)\s+(?:la\s+main|votre\s+(?:message|demande|question))/i,
  /\bje\s+pr[ée]viens\s+(?:le|la)\s+(?:vendeu[rs]e?|boutique)/i,
  /\b(?:le|la)\s+vendeu[rs]e?\s+(?:va\s+vous|vous)\s+(?:r[ée]pond|recontact|contact)/i,
  /\b(?:i\s+will|i'll)\s+(?:hand\s+you\s+over|connect\s+you|pass\s+your\s+(?:message|request))/i,
];

/** « je passe la main au vendeur », « je transmets votre demande », « I'll connect you with the owner »… */
export function announcesHandoff(text: string): boolean {
  return HANDOFF_PHRASES.some((re) => re.test(text));
}

const EN_WORDS =
  /\b(?:the|you|do|does|have|is|are|can|i|my|what|how|much|your|want|to|in|size|deliver|please|hello|hi)\b/g;
const FR_WORDS = /\b(?:le|la|les|vous|est|avez|je|un|une|des|du|de|pour|combien|bonjour|svp|en)\b/g;

/** Enough common English words, and more than French ones, to call a message English. */
export function looksEnglish(text: string): boolean {
  const t = text.toLowerCase();
  const en = (t.match(EN_WORDS) ?? []).length;
  const fr = (t.match(FR_WORDS) ?? []).length;
  return en >= 2 && en > fr;
}
