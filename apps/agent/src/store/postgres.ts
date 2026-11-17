// PostgreSQL conversation store over the Drizzle schema "agent" (packages/db).
// Ids are generated here (UUIDv7, monotonic per process) so ordering matches the in-memory store.

import { agent } from '@selly/db';
import {
  and,
  asc,
  desc,
  drizzle,
  eq,
  gt,
  inArray,
  isNull,
  or,
  type PgDatabase,
  sql,
} from '@selly/db/orm';
import pg from 'pg';
import type { Card, QuickReply } from '../core/types';
import { uuidv7 } from '../ids';
import type {
  AgentStore,
  ChatSessionRecord,
  Conversation,
  ConversationState,
  InboxQuery,
  InboxRow,
  LlmCallRecord,
  MessageStatus,
  NewMessage,
  StoredMessage,
} from './types';

const { conversations, chatSessions, messages, llmCalls, processedEvents } = agent;

type ConvRow = typeof conversations.$inferSelect;
type MsgRow = typeof messages.$inferSelect;

const toConversation = (r: ConvRow): Conversation => ({
  ...r,
  state: (r.state ?? {}) as ConversationState,
});
const toMessage = (r: MsgRow): StoredMessage => ({
  ...r,
  cards: (r.cards ?? []) as Card[],
  quickReplies: (r.quickReplies ?? []) as QuickReply[],
  imageKeys: r.imageKeys ?? [],
});

type AnyPgDatabase = PgDatabase<any, any, any>;

export class PostgresStore implements AgentStore {
  constructor(
    private readonly db: AnyPgDatabase,
    private readonly onClose: () => Promise<void> = async () => {},
  ) {}

  static connect(url: string) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    return new PostgresStore(drizzle(pool), () => pool.end());
  }

  /** Fails when the agent schema has not been migrated. */
  async checkSchema() {
    await this.db.execute(sql`select 1 from agent.conversations limit 0`);
  }

  close() {
    return this.onClose();
  }

  async upsertConversation(input: Parameters<AgentStore['upsertConversation']>[0]) {
    const inserted = await this.db
      .insert(conversations)
      .values({
        id: uuidv7(),
        vendorId: input.vendorId,
        channel: input.channel,
        role: input.role,
        externalUserId: input.externalUserId,
        customerLabel: input.customerLabel ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return toConversation(inserted[0]);
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.vendorId, input.vendorId),
          eq(conversations.channel, input.channel),
          eq(conversations.externalUserId, input.externalUserId),
        ),
      );
    if (!row) throw new Error('conversation upsert found nothing');
    return toConversation(row);
  }

  async getConversation(id: string) {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id));
    return row ? toConversation(row) : null;
  }

  async updateConversation(id: string, patch: Parameters<AgentStore['updateConversation']>[1]) {
    const [row] = await this.db
      .update(conversations)
      .set({
        ...patch,
        state: patch.state as Record<string, unknown> | undefined,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id))
      .returning();
    if (!row) throw new Error(`conversation ${id} not found`);
    return toConversation(row);
  }

  async listInbox(q: InboxQuery) {
    // Last message per conversation, then unread count; one query each, fine for a vendor's inbox.
    const last = this.db
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        lastId: messages.id,
      })
      .from(messages)
      .orderBy(messages.conversationId, desc(messages.id))
      .as('last');
    const filters = [eq(conversations.vendorId, q.vendorId), eq(conversations.role, 'customer')];
    if (q.mode) filters.push(eq(conversations.mode, q.mode));
    if (q.cursor) filters.push(sql`${last.lastId} < ${q.cursor}`);
    const rows = await this.db
      .select({ conversation: conversations, lastId: last.lastId })
      .from(conversations)
      .innerJoin(last, eq(last.conversationId, conversations.id))
      .where(and(...filters))
      .orderBy(desc(last.lastId))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    if (page.length === 0) return { rows: [], nextCursor: null };

    const lastMsgs = await this.db
      .select()
      .from(messages)
      .where(
        inArray(
          messages.id,
          page.map((r) => r.lastId),
        ),
      );
    const unread = await this.db
      .select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          inArray(
            messages.conversationId,
            page.map((r) => r.conversation.id),
          ),
          eq(messages.author, 'customer'),
          or(
            isNull(conversations.vendorReadAt),
            gt(messages.createdAt, conversations.vendorReadAt),
          ),
        ),
      )
      .groupBy(messages.conversationId);

    const result: InboxRow[] = page.map((r) => {
      const lm = lastMsgs.find((m) => m.id === r.lastId);
      return {
        conversation: toConversation(r.conversation),
        lastMessage: lm ? toMessage(lm) : null,
        unreadCount: unread.find((u) => u.conversationId === r.conversation.id)?.n ?? 0,
      };
    });
    return {
      rows: result,
      nextCursor: rows.length > q.limit ? (page.at(-1)?.lastId ?? null) : null,
    };
  }

  async createChatSession(s: Omit<ChatSessionRecord, 'id' | 'createdAt' | 'lastSeenAt'>) {
    const [row] = await this.db
      .insert(chatSessions)
      .values({ ...s, id: uuidv7() })
      .returning();
    if (!row) throw new Error('chat session insert failed');
    return row;
  }

  async findChatSessionByTokenHash(hash: Buffer) {
    const [row] = await this.db.select().from(chatSessions).where(eq(chatSessions.tokenHash, hash));
    return row ?? null;
  }

  async touchChatSession(id: string, expiresAt: Date) {
    await this.db
      .update(chatSessions)
      .set({ lastSeenAt: new Date(), expiresAt })
      .where(eq(chatSessions.id, id));
  }

  async insertMessage(m: NewMessage) {
    const inserted = await this.db
      .insert(messages)
      .values({ ...m, id: uuidv7() })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) return { message: toMessage(inserted[0]), created: true };
    const [existing] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, m.conversationId),
          eq(messages.clientMessageId, m.clientMessageId ?? ''),
        ),
      );
    if (!existing) throw new Error('message insert conflicted but no row was found');
    return { message: toMessage(existing), created: false };
  }

  async setMessageStatus(ids: string[], status: MessageStatus) {
    if (ids.length === 0) return;
    await this.db.update(messages).set({ status }).where(inArray(messages.id, ids));
  }

  async listMessages(conversationId: string, opts: { after?: string; limit: number }) {
    const where = opts.after
      ? and(eq(messages.conversationId, conversationId), gt(messages.id, opts.after))
      : eq(messages.conversationId, conversationId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(where)
      .orderBy(asc(messages.id))
      .limit(opts.limit);
    return rows.map(toMessage);
  }

  async recentMessages(conversationId: string, limit: number) {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.id))
      .limit(limit);
    return rows.reverse().map(toMessage);
  }

  async pendingInbound(conversationId: string) {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.direction, 'in'),
          eq(messages.status, 'accepted'),
        ),
      )
      .orderBy(asc(messages.id));
    return rows.map(toMessage);
  }

  async recordLlmCall(c: LlmCallRecord) {
    await this.db.insert(llmCalls).values({ ...c, id: uuidv7() });
  }

  async hasProcessedEvent(eventId: string) {
    const rows = await this.db
      .select({ id: processedEvents.eventId })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId));
    return rows.length > 0;
  }

  async markEventProcessed(eventId: string, type: string) {
    const rows = await this.db
      .insert(processedEvents)
      .values({ eventId, type })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }
}
