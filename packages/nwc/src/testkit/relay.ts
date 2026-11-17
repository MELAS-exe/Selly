// A minimal NIP-01 relay for tests. Ephemeral events (20000-29999) are forwarded, not stored; replaceable events
// (0, 3, 10000-19999) keep the latest per author and kind. Signatures are verified like a real relay would.
import type { AddressInfo } from 'node:net';
import { type Filter, matchFilter, matchFilters } from 'nostr-tools/filter';
import { type Event, verifyEvent } from 'nostr-tools/pure';
import { type WebSocket, WebSocketServer } from 'ws';

interface Sub {
  socket: WebSocket;
  id: string;
  filters: Filter[];
}

const isEphemeral = (k: number) => k >= 20000 && k < 30000;
const isReplaceable = (k: number) => k === 0 || k === 3 || (k >= 10000 && k < 20000);

export class TestRelay {
  private readonly stored: Event[] = [];
  private readonly subs = new Set<Sub>();
  private offline = false;
  readonly received: Event[] = [];

  private constructor(private readonly wss: WebSocketServer) {
    wss.on('connection', (socket) => {
      if (this.offline) {
        socket.terminate();
        return;
      }
      socket.on('message', (raw) => this.onMessage(socket, raw.toString()));
      socket.on('close', () => {
        for (const s of this.subs) if (s.socket === socket) this.subs.delete(s);
      });
    });
  }

  static async start(): Promise<TestRelay> {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    return new TestRelay(wss);
  }

  get url(): string {
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}`;
  }

  /** Drops every connection and refuses new ones until `goOnline()`. */
  goOffline() {
    this.offline = true;
    for (const c of this.wss.clients) c.terminate();
    this.subs.clear();
  }
  goOnline() {
    this.offline = false;
  }

  async stop() {
    for (const c of this.wss.clients) c.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private send(socket: WebSocket, msg: unknown[]) {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  private onMessage(socket: WebSocket, raw: string) {
    let msg: unknown[];
    try {
      msg = JSON.parse(raw);
    } catch {
      return this.send(socket, ['NOTICE', 'invalid JSON']);
    }
    const [type, ...rest] = msg;
    if (type === 'EVENT') return this.onEvent(socket, rest[0] as Event);
    if (type === 'REQ') {
      const [id, ...filters] = rest as [string, ...Filter[]];
      this.subs.add({ socket, id, filters });
      const matches = this.stored
        .filter((e) => matchFilters(filters, e))
        .sort((a, b) => b.created_at - a.created_at);
      const limit = Math.min(...filters.map((f) => f.limit ?? Number.POSITIVE_INFINITY));
      for (const e of matches.slice(0, limit)) this.send(socket, ['EVENT', id, e]);
      return this.send(socket, ['EOSE', id]);
    }
    if (type === 'CLOSE') {
      for (const s of this.subs) if (s.socket === socket && s.id === rest[0]) this.subs.delete(s);
    }
  }

  private onEvent(socket: WebSocket, e: Event) {
    if (!e || !verifyEvent(e))
      return this.send(socket, ['OK', e?.id ?? '', false, 'invalid: bad signature']);
    this.received.push(e);
    if (!isEphemeral(e.kind)) {
      if (isReplaceable(e.kind)) {
        const i = this.stored.findIndex((s) => s.kind === e.kind && s.pubkey === e.pubkey);
        if (i >= 0) this.stored.splice(i, 1);
      }
      this.stored.push(e);
    }
    this.send(socket, ['OK', e.id, true, '']);
    for (const s of this.subs)
      if (s.filters.some((f) => matchFilter(f, e))) this.send(s.socket, ['EVENT', s.id, e]);
  }
}
