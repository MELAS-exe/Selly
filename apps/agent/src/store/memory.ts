// In-memory conversation store, for tests and the local demo. Same behaviour as the PostgreSQL store.

import { uuidv7 } from '../ids';
import type {
  AgentStore,
  ChatSessionRecord,
  Conversation,
  InboxQuery,
  InboxRow,
  LlmCallRecord,
  MessageStatus,
  NewMessage,
  StoredMessage,
} from './types';

export class MemoryStore implements AgentStore {
  readonly conversations = new Map<string, Conversation>();
  readonly sessions = new Map<string, ChatSessionRecord>();
  readonly messages: StoredMessage[] = [];
  readonly llmCalls: LlmCallRecord[] = [];
  readonly events = new Set<string>();

  async upsertConversation(input: Parameters<AgentStore['upsertConversation']>[0]) {
    for (const c of this.conversations.values()) {
      if (
        c.vendorId === input.vendorId &&
        c.channel === input.channel &&
        c.externalUserId === input.externalUserId
      )
        return structuredClone(c);
    }
    const now = new Date();
    const c: Conversation = {
      id: uuidv7(),
      vendorId: input.vendorId,
      channel: input.channel,
      role: input.role,
      externalUserId: input.externalUserId,
      customerId: null,
      customerLabel: input.customerLabel ?? null,
      mode: 'bot',
      humanUntil: null,
      vendorReadAt: null,
      lastInboundAt: null,
      language: null,
      summary: '',
      state: {},
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(c.id, c);
    return structuredClone(c);
  }

  async getConversation(id: string) {
    const c = this.conversations.get(id);
    return c ? structuredClone(c) : null;
  }

  async updateConversation(id: string, patch: Parameters<AgentStore['updateConversation']>[1]) {
    const c = this.conversations.get(id);
    if (!c) throw new Error(`conversation ${id} not found`);
    Object.assign(c, structuredClone(patch), { updatedAt: new Date() });
    return structuredClone(c);
  }

  async listInbox(q: InboxQuery) {
    const rows: InboxRow[] = [];
    for (const c of this.conversations.values()) {
      if (c.vendorId !== q.vendorId || c.role !== 'customer') continue;
      if (q.mode && c.mode !== q.mode) continue;
      const msgs = this.messages.filter((m) => m.conversationId === c.id);
      const last = msgs.at(-1) ?? null;
      if (!last) continue;
      const unread = msgs.filter(
        (m) => m.author === 'customer' && (!c.vendorReadAt || m.createdAt > c.vendorReadAt),
      ).length;
      rows.push({
        conversation: structuredClone(c),
        lastMessage: structuredClone(last),
        unreadCount: unread,
      });
    }
    // Most recent activity first; the cursor is the last message id of the previous page.
    rows.sort((a, b) => ((a.lastMessage?.id ?? '') < (b.lastMessage?.id ?? '') ? 1 : -1));
    const start = q.cursor ? rows.findIndex((r) => r.lastMessage?.id === q.cursor) + 1 : 0;
    const page = rows.slice(start, start + q.limit);
    const nextCursor =
      start + q.limit < rows.length ? (page.at(-1)?.lastMessage?.id ?? null) : null;
    return { rows: page, nextCursor };
  }

  async createChatSession(s: Omit<ChatSessionRecord, 'id' | 'createdAt' | 'lastSeenAt'>) {
    const now = new Date();
    const rec: ChatSessionRecord = { ...s, id: uuidv7(), createdAt: now, lastSeenAt: now };
    this.sessions.set(rec.id, rec);
    return { ...rec };
  }

  async findChatSessionByTokenHash(hash: Buffer) {
    for (const s of this.sessions.values()) if (s.tokenHash.equals(hash)) return { ...s };
    return null;
  }

  async touchChatSession(id: string, expiresAt: Date) {
    const s = this.sessions.get(id);
    if (s) {
      s.lastSeenAt = new Date();
      s.expiresAt = expiresAt;
    }
  }

  async insertMessage(m: NewMessage) {
    if (m.clientMessageId) {
      const existing = this.messages.find(
        (x) => x.conversationId === m.conversationId && x.clientMessageId === m.clientMessageId,
      );
      if (existing) return { message: structuredClone(existing), created: false };
    }
    const msg: StoredMessage = {
      cards: [],
      quickReplies: [],
      mediaKey: null,
      imageKeys: [],
      quickReplyId: null,
      clientMessageId: null,
      status: null,
      authorLabel: null,
      ...m,
      id: uuidv7(),
      createdAt: new Date(),
    };
    this.messages.push(msg);
    return { message: structuredClone(msg), created: true };
  }

  async setMessageStatus(ids: string[], status: MessageStatus) {
    for (const m of this.messages) if (ids.includes(m.id)) m.status = status;
  }

  async listMessages(conversationId: string, opts: { after?: string; limit: number }) {
    return this.messages
      .filter((m) => m.conversationId === conversationId && (!opts.after || m.id > opts.after))
      .slice(0, opts.limit)
      .map((m) => structuredClone(m));
  }

  async recentMessages(conversationId: string, limit: number) {
    return this.messages
      .filter((m) => m.conversationId === conversationId)
      .slice(-limit)
      .map((m) => structuredClone(m));
  }

  async pendingInbound(conversationId: string) {
    return this.messages
      .filter(
        (m) =>
          m.conversationId === conversationId && m.direction === 'in' && m.status === 'accepted',
      )
      .map((m) => structuredClone(m));
  }

  async recordLlmCall(c: LlmCallRecord) {
    this.llmCalls.push(c);
  }

  async hasProcessedEvent(eventId: string) {
    return this.events.has(eventId);
  }

  async markEventProcessed(eventId: string) {
    if (this.events.has(eventId)) return false;
    this.events.add(eventId);
    return true;
  }
}
