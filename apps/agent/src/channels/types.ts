// The agent engine does not know its channel (architecture.md section 3.9). The web chat is the first adapter.

import type { Card, QuickReply } from '../core/types';

export type Channel = 'web' | 'whatsapp' | 'instagram';

export interface ConversationRef {
  conversationId: string;
  vendorId: string;
  channel: Channel;
}

export interface NormalisedMessage {
  channel: Channel;
  conversationId: string;
  clientMessageId: string;
  role: 'customer' | 'vendor';
  kind: 'text' | 'audio' | 'image';
  text?: string;
  mediaKey?: string;
  quickReplyId?: string;
  receivedAt: string;
}

export interface AgentReply {
  text: string;
  cards: Card[];
  quickReplies: QuickReply[];
}

export interface ChannelAdapter {
  readonly channel: Channel;
  normalise(input: unknown): Promise<NormalisedMessage | null>;
  send(conversation: ConversationRef, reply: AgentReply): Promise<{ providerMessageId?: string }>;
  /** Reply window in hours: 24 for Meta, none for the web. */
  readonly windowHours?: number;
}
