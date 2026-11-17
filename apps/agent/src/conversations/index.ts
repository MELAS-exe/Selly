// Conversation store operations shared by the chat, the inbox, the assistant and core events:
// the conversation mode machine of architecture.md section 4.4, and storing plus publishing messages.

import type {
  AgentReply,
  ChannelAdapter,
  ConversationRef,
  NormalisedMessage,
} from '../channels/types';
import type { EventHub } from '../chat/hub';
import type { Card, QuickReply } from '../core/types';
import type {
  AgentStore,
  Conversation,
  ConversationMode,
  NewMessage,
  StoredMessage,
} from '../store/types';

/** The ChatMessage of docs/api.json. */
export interface ChatMessageView {
  id: string;
  conversation_id: string;
  author: StoredMessage['author'];
  author_label: string | null;
  kind: StoredMessage['kind'];
  text: string | null;
  cards: Card[];
  quick_replies: QuickReply[];
  media_key: string | null;
  client_message_id: string | null;
  status: 'accepted' | 'processed' | 'failed';
  created_at: string;
}

export function toChatMessage(m: StoredMessage): ChatMessageView {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    author: m.author,
    author_label: m.authorLabel,
    kind: m.kind,
    text: m.text,
    cards: m.cards,
    quick_replies: m.quickReplies,
    media_key: m.mediaKey,
    client_message_id: m.clientMessageId,
    status: m.status ?? 'processed',
    created_at: m.createdAt.toISOString(),
  };
}

export const assistantLabel = (shopName: string) => `Assistant de ${shopName}`;
export const vendorLabel = (shopName: string) => `${shopName} (vendeur)`;

export class ConversationService {
  constructor(
    private readonly store: AgentStore,
    private readonly hub: EventHub,
    private readonly humanMinutes: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The mode in force now: `human` (or a timed `paused`) falls back to `bot` once `human_until` has passed.
   * Returns the conversation, updated and announced if the mode changed.
   */
  async refreshMode(conv: Conversation): Promise<Conversation> {
    if (conv.mode !== 'bot' && conv.humanUntil && conv.humanUntil <= this.now()) {
      return this.setMode(conv, 'bot', null, 'system');
    }
    return conv;
  }

  async setMode(
    conv: Conversation,
    mode: ConversationMode,
    humanUntil: Date | null,
    by: 'vendor' | 'agent' | 'system',
    label?: string,
  ): Promise<Conversation> {
    const updated = await this.store.updateConversation(conv.id, { mode, humanUntil });
    if (updated.mode !== conv.mode) {
      // The customer widget only distinguishes bot and human (docs/api.json, `mode` event).
      this.hub.publish(conv.id, 'mode', {
        mode: mode === 'bot' ? 'bot' : 'human',
        by,
        ...(label ? { label } : {}),
      });
    }
    return updated;
  }

  /** `human` for the given minutes (default 30, section 6.6). */
  humanUntilFromNow(minutes = this.humanMinutes) {
    return new Date(this.now().getTime() + minutes * 60_000);
  }

  async insertAndPublish(m: NewMessage): Promise<{ message: StoredMessage; created: boolean }> {
    const res = await this.store.insertMessage(m);
    if (res.created) this.hub.publish(m.conversationId, 'message', toChatMessage(res.message));
    return res;
  }

  async agentReply(conv: Conversation, reply: AgentReply, label: string) {
    const hasOrder = reply.cards.some((c) => c.type === 'order');
    return (
      await this.insertAndPublish({
        conversationId: conv.id,
        direction: 'out',
        author: 'agent',
        authorLabel: label,
        kind: hasOrder ? 'order_link' : 'text',
        text: reply.text,
        cards: reply.cards,
        quickReplies: reply.quickReplies,
        status: 'processed',
      })
    ).message;
  }

  async systemMessage(
    conv: Conversation,
    text: string,
    cards: Card[] = [],
    quickReplies: QuickReply[] = [],
  ) {
    return (
      await this.insertAndPublish({
        conversationId: conv.id,
        direction: 'out',
        author: 'system',
        kind: 'system',
        text,
        cards,
        quickReplies,
        status: 'processed',
      })
    ).message;
  }

  typing(conversationId: string, on: boolean) {
    this.hub.publish(conversationId, 'typing', { on });
  }
}

/** The web chat channel: the reply is stored and published on the conversation's SSE stream. */
export class WebChannelAdapter implements ChannelAdapter {
  readonly channel = 'web' as const;
  constructor(
    private readonly conversations: ConversationService,
    private readonly store: AgentStore,
    private readonly labelFor: (vendorId: string) => Promise<string>,
  ) {}

  async normalise(input: unknown): Promise<NormalisedMessage | null> {
    const b = input as {
      conversationId: string;
      client_message_id: string;
      kind: 'text' | 'audio';
      text?: string;
      media_key?: string;
      quick_reply_id?: string;
    };
    if (!b?.conversationId || !b.client_message_id) return null;
    return {
      channel: 'web',
      conversationId: b.conversationId,
      clientMessageId: b.client_message_id,
      role: 'customer',
      kind: b.kind,
      text: b.text,
      mediaKey: b.media_key,
      quickReplyId: b.quick_reply_id,
      receivedAt: new Date().toISOString(),
    };
  }

  async send(ref: ConversationRef, reply: AgentReply) {
    const conv = await this.store.getConversation(ref.conversationId);
    if (!conv) throw new Error(`conversation ${ref.conversationId} not found`);
    const msg = await this.conversations.agentReply(conv, reply, await this.labelFor(ref.vendorId));
    return { providerMessageId: msg.id };
  }
}
