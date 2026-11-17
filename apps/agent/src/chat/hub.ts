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

const IDLE_MS = 60 * 60_000;

export class EventHub {
  private readonly seq = new Map<string, number>();
  private readonly buffers = new Map<string, HubEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly lastActivity = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  publish(
    conversationId: string,
    event: HubEvent['event'],
    data: unknown,
    audience: HubEvent['audience'] = 'all',
  ) {
    // Ids follow the clock (and stay strictly increasing), so they keep increasing after a sweep
    // forgets a conversation: a client that resumes with an older Last-Event-ID misses nothing new.
    const t = this.now();
    const id = Math.max((this.seq.get(conversationId) ?? 0) + 1, t);
    this.seq.set(conversationId, id);
    this.lastActivity.set(conversationId, t);
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

  /** Forgets conversations with no open stream and no event for an hour. Returns how many. */
  sweep(): number {
    const t = this.now();
    let n = 0;
    for (const [id, at] of this.lastActivity) {
      if (t - at < IDLE_MS || this.listeners.has(id)) continue;
      this.seq.delete(id);
      this.buffers.delete(id);
      this.lastActivity.delete(id);
      n++;
    }
    return n;
  }

  size() {
    return this.buffers.size;
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
