// Response shapes from docs/api.json (tag "Chat"), limited to what the widget reads.
import type { Money, OrderStatus } from './types';

export type ChatAuthor = 'customer' | 'agent' | 'vendor' | 'system';
export type ChatMessageKind = 'text' | 'audio' | 'image' | 'order_link' | 'system';

export interface ProductCard {
  type: 'product';
  product_id: string;
  title: string;
  price: Money;
  image_url: string | null;
  url: string;
}

export interface OrderCard {
  type: 'order';
  number: string;
  status: OrderStatus;
  total: Money;
  total_sat: number;
  checkout_url: string;
  expires_at: string | null;
}

export type ChatCard = ProductCard | OrderCard;

export interface QuickReply {
  id: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  author: ChatAuthor;
  author_label: string | null;
  kind: ChatMessageKind;
  text: string | null;
  cards: ChatCard[];
  quick_replies: QuickReply[];
  media_key: string | null;
  client_message_id: string | null;
  status: 'accepted' | 'processed' | 'failed';
  created_at: string;
}

export interface ChatSession {
  session_token: string;
  conversation_id: string;
  expires_at: string;
  store: { slug: string; display_name: string };
  disclosure: string;
  features: { voice_notes: boolean };
  messages: ChatMessage[];
}
