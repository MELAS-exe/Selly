// Turn processing (architecture.md sections 7.2 and 8.2): one turn at a time per conversation,
// messages that arrive within the merge window go into the same turn, then entitlements, mode,
// voice notes, the engine, storage, the SSE publish, usage and the handoff.
//
// In memory: one agent instance in the MVP. With several instances this becomes a pg-boss job with a
// singleton key per conversation, behind the same `schedule` call.

import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { type AsrProvider, type AudioUploads, MIN_ASR_CONFIDENCE } from '../asr';
import type { AgentReply } from '../channels/types';
import type { CoreClient } from '../core/client';
import type { AgentProfile, NotificationRequest } from '../core/types';
import {
  type AgentEngine,
  FIXED_HANDOFF_REPLY,
  type TurnResult,
  TurnTimeoutError,
} from '../engine';
import {
  checkTurn,
  type EntitlementsCache,
  type ProfileCache,
  type RateLimiter,
  type UsageReporter,
} from '../quota';
import type { AgentStore, Conversation, StoredMessage } from '../store/types';
import type { HandoffRequest } from '../tools';
import { assistantLabel, type ConversationService } from '.';

export interface TurnDeps {
  store: AgentStore;
  core: CoreClient;
  engine: AgentEngine;
  conversations: ConversationService;
  entitlements: EntitlementsCache;
  usage: UsageReporter;
  profiles: ProfileCache;
  asr: AsrProvider;
  uploads: AudioUploads;
  /** 30 turns per hour per conversation (section 8.4). */
  turnLimiter: RateLimiter;
  mergeWindowMs: number;
  appBaseUrl: string;
  log: FastifyBaseLogger;
}

export interface TurnOutcome {
  reply: StoredMessage;
  result?: TurnResult;
}

const NOTIFY_EVERY_MS = 10 * 60_000;
const SUMMARY_EVERY_TURNS = 6;

export class TurnService {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastNotified = new Map<string, number>();
  /** Vendors who paused the bot for all chats, until a date (null: until resumed). */
  private readonly pausedVendors = new Map<string, Date | null>();
  private readonly background = new Set<Promise<unknown>>();

  constructor(private readonly d: TurnDeps) {}

  /** Called after a customer message is stored: a turn runs once the merge window is quiet. */
  schedule(conversationId: string) {
    const existing = this.timers.get(conversationId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(conversationId);
      void this.runNow(conversationId).catch((err) =>
        this.d.log.error({ err, conversationId }, 'turn failed'),
      );
    }, this.d.mergeWindowMs);
    this.timers.set(conversationId, timer);
  }

  /** Runs a turn now, after any turn already running for this conversation. */
  runNow(conversationId: string): Promise<TurnOutcome | null> {
    const prev = this.chains.get(conversationId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.processOnce(conversationId));
    this.chains.set(conversationId, next);
    void next
      .finally(() => {
        if (this.chains.get(conversationId) === next) this.chains.delete(conversationId);
      })
      .catch(() => undefined);
    return next;
  }

  /** Resolves when no turn is scheduled or running (tests, graceful shutdown). */
  async idle(): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      if (this.timers.size === 0 && this.chains.size === 0 && this.background.size === 0) return;
      await Promise.allSettled([...this.chains.values(), ...this.background]);
      if (this.timers.size > 0) await new Promise((r) => setTimeout(r, this.d.mergeWindowMs + 5));
    }
  }

  /** Background work (summaries, draft extraction) that idle() and shutdown wait for. */
  track(p: Promise<unknown>) {
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }

  isVendorPaused(vendorId: string): boolean {
    if (!this.pausedVendors.has(vendorId)) return false;
    const until = this.pausedVendors.get(vendorId);
    if (until && until <= new Date()) {
      this.pausedVendors.delete(vendorId);
      return false;
    }
    return true;
  }

  /** set_bot_mode (vendor assistant) and the inbox "pause all" switch. */
  async setVendorBotMode(vendorId: string, mode: 'bot' | 'paused', minutes?: number) {
    if (mode === 'paused') {
      this.pausedVendors.set(vendorId, minutes ? new Date(Date.now() + minutes * 60_000) : null);
      return;
    }
    this.pausedVendors.delete(vendorId);
    // Chats that waited while the bot was paused get their answer now (section 4.4).
    const { rows } = await this.d.store.listInbox({ vendorId, mode: 'bot', limit: 100 });
    for (const r of rows) {
      if (r.lastMessage?.direction === 'in' && r.lastMessage.status === 'accepted')
        this.schedule(r.conversation.id);
    }
  }

  private async processOnce(conversationId: string): Promise<TurnOutcome | null> {
    let conv = await this.d.store.getConversation(conversationId);
    if (!conv) return null;
    conv = await this.d.conversations.refreshMode(conv);
    const pending = await this.d.store.pendingInbound(conv.id);
    if (pending.length === 0) return null;

    if (conv.role === 'customer' && (conv.mode !== 'bot' || this.isVendorPaused(conv.vendorId))) {
      // The vendor is answering: the message is only stored, and the vendor is alerted (section 7.2).
      await this.notify(conv, {
        type: 'conversation.new',
        title: 'Nouveau message client',
        body: pending.at(-1)?.text?.slice(0, 120) ?? 'Message vocal',
      });
      return null;
    }

    let profile: AgentProfile;
    try {
      profile = await this.d.profiles.get(conv.vendorId);
    } catch (err) {
      this.d.log.error({ err, vendorId: conv.vendorId }, 'agent profile unavailable');
      return this.fixedHandoff(conv, pending, 'Assistant', {
        reason: 'other',
        summary: 'Profil boutique indisponible.',
      });
    }
    const label = assistantLabel(profile.display_name);

    if (conv.role === 'customer') {
      if (!this.d.turnLimiter.take(conv.id).allowed) {
        return this.fixedHandoff(conv, pending, label, {
          reason: 'other',
          summary: 'Plus de 30 messages en une heure.',
        });
      }
      const check = checkTurn(await this.d.entitlements.get(conv.vendorId));
      if (!check.ok) {
        if (check.reason === 'quota_exceeded') {
          await this.notify(conv, {
            type: 'usage.warning',
            title: 'Quota de réponses atteint',
            body: 'L’assistant ne répond plus ce mois-ci. Passez à l’offre supérieure ou répondez vous-même.',
          });
        }
        return this.fixedHandoff(conv, pending, label, {
          reason: 'other',
          summary: `Assistant indisponible (${check.reason}).`,
        });
      }
      // Voice notes need a plan with the feature and a usable transcript.
      const voice = await this.transcribe(pending, check.entitlements.features.voice_notes);
      if (voice.ask) {
        const reply = await this.d.conversations.agentReply(
          conv,
          { text: voice.ask, cards: [], quickReplies: [] },
          label,
        );
        await this.d.store.setMessageStatus(
          pending.map((m) => m.id),
          'processed',
        );
        return { reply };
      }
      return this.runEngine(conv, profile, pending, label, voice.transcripts);
    }

    return this.runEngine(conv, profile, pending, label, {});
  }

  private async transcribe(
    pending: StoredMessage[],
    allowed: boolean,
  ): Promise<{ transcripts: Record<string, string>; ask?: string }> {
    const transcripts: Record<string, string> = {};
    const audio = pending.filter((m) => m.kind === 'audio');
    if (audio.length === 0) return { transcripts };
    if (!allowed) return { transcripts, ask: 'Écrivez-moi votre message, s’il vous plaît.' };
    let understood = 0;
    for (const m of audio) {
      const up = m.mediaKey ? this.d.uploads.get(m.mediaKey) : null;
      const t = up?.bytes
        ? await this.d.asr.transcribe(up.bytes, up.contentType).catch(() => null)
        : null;
      if (t && t.confidence >= MIN_ASR_CONFIDENCE && t.text.trim()) {
        transcripts[m.id] = t.text.trim();
        understood++;
      }
    }
    const hasText = pending.some((m) => m.kind !== 'audio' && m.text);
    if (understood === 0 && !hasText)
      return { transcripts, ask: 'Je n’ai pas bien compris le vocal, pouvez-vous l’écrire ?' };
    return { transcripts };
  }

  private async runEngine(
    conv: Conversation,
    profile: AgentProfile,
    pending: StoredMessage[],
    label: string,
    transcripts: Record<string, string>,
  ): Promise<TurnOutcome> {
    // Quick-reply taps without text become the button's label (section 8.2 step 3).
    const recent = await this.d.store.recentMessages(conv.id, 12);
    for (const m of pending) {
      if (!m.text && m.quickReplyId && !transcripts[m.id]) {
        const qr = recent.flatMap((x) => x.quickReplies).find((q) => q.id === m.quickReplyId);
        if (qr) transcripts[m.id] = qr.label;
      }
    }

    this.d.conversations.typing(conv.id, true);
    let result: TurnResult;
    try {
      result = await this.d.engine.runTurn({
        conversation: conv,
        profile,
        inbound: pending,
        transcripts,
        requestId: randomUUID().replaceAll('-', ''),
        setBotMode: async (scope, mode, minutes) => {
          if (scope === 'all') await this.setVendorBotMode(conv.vendorId, mode, minutes);
        },
        reportDraftUsage: async (reference) => {
          await this.d.usage.report(conv.vendorId, { metric: 'drafts', quantity: 1, reference });
        },
      });
    } catch (err) {
      this.d.conversations.typing(conv.id, false);
      const timeout = err instanceof TurnTimeoutError;
      this.d.log.error(
        { err, conversationId: conv.id },
        timeout ? 'turn deadline exceeded' : 'turn failed',
      );
      if (conv.role === 'vendor') {
        const reply = await this.d.conversations.agentReply(
          conv,
          {
            text: 'Je n’ai pas pu traiter votre demande. Réessayez dans un instant.',
            cards: [],
            quickReplies: [],
          },
          label,
        );
        await this.d.store.setMessageStatus(
          pending.map((m) => m.id),
          'failed',
        );
        return { reply };
      }
      return this.fixedHandoff(conv, pending, label, {
        reason: 'other',
        summary: timeout
          ? 'L’assistant a mis trop de temps à répondre.'
          : 'Erreur technique de l’assistant.',
      });
    }
    this.d.conversations.typing(conv.id, false);

    const last = pending.at(-1) as StoredMessage;
    conv = await this.d.store.updateConversation(conv.id, {
      state: result.state,
      lastInboundAt: last.createdAt,
    });
    const reply = await this.d.conversations.agentReply(conv, result.reply, label);
    await this.d.store.setMessageStatus(
      pending.map((m) => m.id),
      'processed',
    );

    if (result.handoff && conv.role === 'customer') await this.handoff(conv, result.handoff);

    if (conv.role === 'customer') {
      const usage = await this.d.usage.report(conv.vendorId, {
        metric: 'agent_turns',
        quantity: 1,
        reference: last.id,
      });
      if (usage?.warning && !usage.exceeded && usage.used === Math.ceil(usage.limit * 0.8)) {
        await this.notify(conv, {
          type: 'usage.warning',
          title: '80 % des réponses du mois utilisées',
          body: `${usage.used} sur ${usage.limit} réponses de l’assistant.`,
        });
      }
    }

    if ((result.state.turnsSinceSummary ?? 0) >= SUMMARY_EVERY_TURNS) {
      this.track(
        this.d.engine.summarise(conv).then(async (summary) => {
          const fresh = await this.d.store.getConversation(conv.id);
          if (!fresh) return;
          await this.d.store.updateConversation(conv.id, {
            ...(summary ? { summary } : {}),
            state: { ...fresh.state, turnsSinceSummary: 0 },
          });
        }),
      );
    }
    return { reply, result };
  }

  private async fixedHandoff(
    conv: Conversation,
    pending: StoredMessage[],
    label: string,
    handoff: HandoffRequest,
  ): Promise<TurnOutcome> {
    const fixed: AgentReply = { text: FIXED_HANDOFF_REPLY, cards: [], quickReplies: [] };
    const reply = await this.d.conversations.agentReply(conv, fixed, label);
    await this.d.store.setMessageStatus(
      pending.map((m) => m.id),
      'processed',
    );
    if (conv.role === 'customer') await this.handoff(conv, handoff);
    return { reply };
  }

  private async handoff(conv: Conversation, h: HandoffRequest) {
    await this.d.conversations.setMode(
      conv,
      'human',
      this.d.conversations.humanUntilFromNow(),
      'agent',
    );
    await this.notify(
      conv,
      {
        type: 'conversation.handoff',
        title: 'Un client attend votre réponse',
        body: h.summary.slice(0, 200),
      },
      true,
    );
  }

  private async notify(
    conv: Conversation,
    n: Omit<NotificationRequest, 'conversation_id' | 'url'>,
    force = false,
  ) {
    const key = `${conv.id}:${n.type}`;
    const t = Date.now();
    if (!force && t - (this.lastNotified.get(key) ?? 0) < NOTIFY_EVERY_MS) return;
    this.lastNotified.set(key, t);
    try {
      await this.d.core.notifyVendor(conv.vendorId, {
        ...n,
        conversation_id: conv.id,
        url: `${this.d.appBaseUrl}/app/conversations/${conv.id}`,
      });
    } catch (err) {
      this.d.log.warn({ err, conversationId: conv.id }, 'vendor notification failed');
    }
  }
}
