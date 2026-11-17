// Fan-out of chat events between agent instances, over PostgreSQL LISTEN/NOTIFY (ADR-08: no Redis).
// A reply produced on instance A reaches a customer whose SSE stream is open on instance B.

import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export interface EventBus {
  publish(message: string): Promise<void>;
  subscribe(onMessage: (message: string) => void): Promise<void>;
  close(): Promise<void>;
}

export const CHANNEL = 'agent_events';
/** NOTIFY payloads must stay under 8000 bytes; larger events travel as a reference. */
export const MAX_PAYLOAD = 7500;

/** LISTEN needs its own connection, outside the pool: a pooled one would drop the subscription. */
export class PgBus implements EventBus {
  private listener: pg.PoolClient | null = null;
  private closed = false;
  private onMessage: ((message: string) => void) | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly log: { warn: (o: object, m: string) => void },
  ) {}

  async publish(message: string) {
    await this.pool.query('select pg_notify($1, $2)', [CHANNEL, message]);
  }

  async subscribe(onMessage: (message: string) => void) {
    this.onMessage = onMessage;
    await this.connect();
  }

  private async connect() {
    if (this.closed || !this.onMessage) return;
    try {
      const client = await this.pool.connect();
      this.listener = client;
      client.on('notification', (n) => {
        if (n.channel === CHANNEL && n.payload) this.onMessage?.(n.payload);
      });
      client.on('error', (err) => {
        this.log.warn({ err }, 'event bus connection lost, reconnecting');
        this.reconnect(client);
      });
      await client.query(`listen ${CHANNEL}`);
    } catch (err) {
      this.log.warn({ err }, 'event bus could not listen, retrying');
      setTimeout(() => void this.connect(), 1000).unref();
    }
  }

  private reconnect(client: pg.PoolClient) {
    if (this.listener === client) this.listener = null;
    client.release(true);
    setTimeout(() => void this.connect(), 1000).unref();
  }

  async close() {
    this.closed = true;
    const client = this.listener;
    this.listener = null;
    if (client) {
      await client.query(`unlisten ${CHANNEL}`).catch(() => undefined);
      client.release();
    }
  }
}

/** An in-process bus shared by several hubs, to test the fan-out without a database. */
export class LocalBus implements EventBus {
  private readonly subscribers = new Set<(m: string) => void>();
  async publish(message: string) {
    for (const s of this.subscribers) queueMicrotask(() => s(message));
  }
  async subscribe(onMessage: (m: string) => void) {
    this.subscribers.add(onMessage);
  }
  async close() {
    this.subscribers.clear();
  }
}

export const newInstanceId = () => randomUUID();
