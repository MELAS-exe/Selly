// Live events per conversation, for the chat widget and the vendor's open thread (ADR-09, section 3.8).
// In memory: one agent instance in the MVP. With several instances this becomes LISTEN/NOTIFY
// on PostgreSQL, behind the same interface.

import type { FastifyReply, FastifyRequest } from 'fastify';

export type Audience = 'customer' | 'vendor';

export interface HubEvent {
  id: number;
  event: 'message' | 'typing' | 'mode' | 'read';
  data: unknown;
  /** Who may see it: `read` is only for the vendor's stream. */
  audience: Audience | 'all';
}

type Listener = (e: HubEvent) => void;

const BUFFER = 200;

export class EventHub {
  private readonly seq = new Map<string, number>();
  private readonly buffers = new Map<string, HubEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(
    conversationId: string,
    event: HubEvent['event'],
    data: unknown,
    audience: HubEvent['audience'] = 'all',
  ) {
    const id = (this.seq.get(conversationId) ?? 0) + 1;
    this.seq.set(conversationId, id);
    const e: HubEvent = { id, event, data, audience };
    const buf = this.buffers.get(conversationId) ?? [];
    buf.push(e);
    if (buf.length > BUFFER) buf.shift();
    this.buffers.set(conversationId, buf);
    for (const l of this.listeners.get(conversationId) ?? []) l(e);
    return e;
  }

  /** Events after `lastEventId`, for a client that resumes with Last-Event-ID. */
  since(conversationId: string, lastEventId: number): HubEvent[] {
    return (this.buffers.get(conversationId) ?? []).filter((e) => e.id > lastEventId);
  }

  subscribe(conversationId: string, l: Listener): () => void {
    const set = this.listeners.get(conversationId) ?? new Set();
    set.add(l);
    this.listeners.set(conversationId, set);
    return () => {
      set.delete(l);
      if (set.size === 0) this.listeners.delete(conversationId);
    };
  }

  listenerCount(conversationId: string) {
    return this.listeners.get(conversationId)?.size ?? 0;
  }
}

const PING_MS = 20_000;

/** Streams a conversation's events as SSE, with replay from Last-Event-ID and a ping every 20 s. */
export function streamEvents(
  hub: EventHub,
  conversationId: string,
  audience: Audience,
  req: FastifyRequest,
  reply: FastifyReply,
  onOpen?: () => void,
) {
  const lastHeader = req.headers['last-event-id'];
  const lastId = Number(Array.isArray(lastHeader) ? lastHeader[0] : lastHeader) || 0;

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const write = (e: HubEvent) => {
    if (e.audience !== 'all' && e.audience !== audience) return;
    res.write(`event: ${e.event}\nid: ${e.id}\ndata: ${JSON.stringify(e.data)}\n\n`);
  };
  res.write('retry: 3000\n\n');
  for (const e of hub.since(conversationId, lastId)) write(e);
  const unsubscribe = hub.subscribe(conversationId, write);
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);
  onOpen?.();
  const close = () => {
    clearInterval(ping);
    unsubscribe();
  };
  req.raw.on('close', close);
  res.on('error', close);
}
