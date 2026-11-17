// Conversation store: the agent schema of architecture.md section 4.3.
// Two implementations: in memory (tests, local demo) and PostgreSQL (store/postgres.ts).

import type { Card, QuickReply } from '../core/types';

export type Channel = 'web' | 'whatsapp' | 'instagram';
export type ConversationRole = 'customer' | 'vendor';
export type ConversationMode = 'bot' | 'human' | 'paused';
export type Author = 'customer' | 'vendor' | 'agent' | 'system';
export type MessageKind = 'text' | 'audio' | 'image' | 'order_link' | 'system';
export type MessageStatus = 'accepted' | 'processed' | 'failed';

/** What the agent remembers between turns: never prices or stock (section 7.6). */
export interface ConversationState {
  /** Product the customer was viewing when the chat opened, or asked about. */
  productInView?: string;
  /** Variant ids and quantities the customer wants to buy. */
  cart?: { variant_id: string; quantity: number }[];
  /** Last quote total, so create_order can send expected_total. */
  lastQuoteTotal?: { amount: number; currency: 'XOF' | 'SAT' };
  /** The last quote: create_order must use the same items and delivery, and sends its total. */
  lastQuote?: {
    items: { variant_id: string; quantity: number }[];
    delivery: unknown;
    total: { amount: number; currency: 'XOF' | 'SAT' };
  };
  /** Last order number created in this chat. */
  lastOrderNumber?: string;
  /** Order number to checkout URL, for the order cards of payment messages. */
  orders?: Record<string, string>;
  /** Vendor assistant: draft under review. */
  draftId?: string;
  /** Vendor assistant: answers to the draft's questions, sent on confirmation. */
  draftAnswers?: Record<string, string>;
  /** Count of turns since the summary was refreshed. */
  turnsSinceSummary?: number;
  /** Consecutive turns where the agent did not understand. */
  misunderstandings?: number;
  /** Customer name and phone given in the chat, kept for the order form. */
  customer?: { display_name?: string; phone_e164?: string };
}

export interface Conversation {
  id: string;
  vendorId: string;
  channel: Channel;
  role: ConversationRole;
  externalUserId: string;
  customerId: string | null;
  customerLabel: string | null;
  mode: ConversationMode;
  humanUntil: Date | null;
  vendorReadAt: Date | null;
  lastInboundAt: Date | null;
  language: string | null;
  summary: string;
  state: ConversationState;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSessionRecord {
  id: string;
  vendorId: string;
  conversationId: string;
  tokenHash: Buffer;
  ipHash: Buffer | null;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  author: Author;
  authorLabel: string | null;
  kind: MessageKind;
  text: string | null;
  cards: Card[];
  quickReplies: QuickReply[];
  mediaKey: string | null;
  imageKeys: string[];
  quickReplyId: string | null;
  clientMessageId: string | null;
  status: MessageStatus | null;
  createdAt: Date;
}

export type NewMessage = Omit<
  StoredMessage,
  | 'id'
  | 'createdAt'
  | 'cards'
  | 'quickReplies'
  | 'mediaKey'
  | 'imageKeys'
  | 'quickReplyId'
  | 'clientMessageId'
  | 'status'
  | 'authorLabel'
> &
  Partial<
    Pick<
      StoredMessage,
      | 'cards'
      | 'quickReplies'
      | 'mediaKey'
      | 'imageKeys'
      | 'quickReplyId'
      | 'clientMessageId'
      | 'status'
      | 'authorLabel'
    >
  >;

export interface LlmCallRecord {
  conversationId: string | null;
  vendorId: string | null;
  purpose: 'reply' | 'summary' | 'extraction' | 'transcription';
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: unknown;
  error: string | null;
}

export interface InboxQuery {
  vendorId: string;
  mode?: ConversationMode;
  cursor?: string;
  limit: number;
}

export interface InboxRow {
  conversation: Conversation;
  lastMessage: StoredMessage | null;
  unreadCount: number;
}

export interface AgentStore {
  /** Finds or creates the conversation for (vendor, channel, external user). */
  upsertConversation(input: {
    vendorId: string;
    channel: Channel;
    role: ConversationRole;
    externalUserId: string;
    customerLabel?: string | null;
  }): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  updateConversation(
    id: string,
    patch: Partial<
      Pick<
        Conversation,
        | 'mode'
        | 'humanUntil'
        | 'vendorReadAt'
        | 'lastInboundAt'
        | 'language'
        | 'summary'
        | 'state'
        | 'customerLabel'
        | 'customerId'
      >
    >,
  ): Promise<Conversation>;
  listInbox(q: InboxQuery): Promise<{ rows: InboxRow[]; nextCursor: string | null }>;

  createChatSession(
    s: Omit<ChatSessionRecord, 'id' | 'createdAt' | 'lastSeenAt'>,
  ): Promise<ChatSessionRecord>;
  findChatSessionByTokenHash(hash: Buffer): Promise<ChatSessionRecord | null>;
  touchChatSession(id: string, expiresAt: Date): Promise<void>;

  /** Inserts a message. A repeated (conversation, client_message_id) returns the stored one with created=false. */
  insertMessage(m: NewMessage): Promise<{ message: StoredMessage; created: boolean }>;
  setMessageStatus(ids: string[], status: MessageStatus): Promise<void>;
  /** Messages in id order (UUIDv7 is time ordered), after the given id if any. */
  listMessages(
    conversationId: string,
    opts: { after?: string; limit: number },
  ): Promise<StoredMessage[]>;
  /** The most recent messages, oldest first. */
  recentMessages(conversationId: string, limit: number): Promise<StoredMessage[]>;
  /** Inbound messages still waiting for a turn. */
  pendingInbound(conversationId: string): Promise<StoredMessage[]>;

  recordLlmCall(c: LlmCallRecord): Promise<void>;
  hasProcessedEvent(eventId: string): Promise<boolean>;
  /** Returns true the first time an event id is seen. */
  markEventProcessed(eventId: string, type: string): Promise<boolean>;
}
