// Wake-ups for live streams across core processes, over PostgreSQL LISTEN/NOTIFY (ADR-08: no Redis).
// A writer calls signal() inside its transaction; PostgreSQL delivers the NOTIFY on commit, so a stream never wakes
// up before the row it will read is visible. Each process holds one LISTEN connection and passes the wake-up to the
// streams it serves. A signal carries no data, only "look again": streams still read the database, and keep a slow
// poll in case the LISTEN connection is down.
import { EventEmitter } from 'node:events';
import { sql } from '@selly/db/orm';
import type pg from 'pg';
import type { Database, Logger } from './context';

export const SIGNAL_CHANNEL = 'selly_signal';
export type SignalTopic = 'vendor' | 'order';

export async function signal(tx: Database, topic: SignalTopic, key: string) {
  await tx.execute(sql`select pg_notify(${SIGNAL_CHANNEL}, ${`${topic}:${key}`})`);
}

export class Signals {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open stream; thousands of dashboards are normal.
    this.emitter.setMaxListeners(0);
  }

  /** Calls `fn` on every signal for this key. Returns the function that stops it. */
  on(topic: SignalTopic, key: string, fn: () => void): () => void {
    const name = `${topic}:${key}`;
    this.emitter.on(name, fn);
    return () => this.emitter.off(name, fn);
  }

  /** A NOTIFY payload arrived. */
  deliver(payload: string) {
    this.emitter.emit(payload);
  }

  close() {}
}

/**
 * LISTEN on a dedicated connection taken from the pool (a pooled one would drop the subscription when released).
 * Reconnects after a second when the connection fails; streams poll meanwhile.
 */
export class PgSignals extends Signals {
  private client: pg.PoolClient | null = null;
  private closed = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly log: Logger,
  ) {
    super();
  }

  async start() {
    if (this.closed) return;
    try {
      const client = await this.pool.connect();
      this.client = client;
      client.on('notification', (n) => {
        if (n.channel === SIGNAL_CHANNEL && n.payload) this.deliver(n.payload);
      });
      client.on('error', (err) => {
        this.log.warn({ err: String(err) }, 'signal connection lost, reconnecting');
        if (this.client === client) this.client = null;
        client.release(true);
        setTimeout(() => void this.start(), 1000).unref();
      });
      await client.query(`listen ${SIGNAL_CHANNEL}`);
    } catch (err) {
      this.log.warn({ err: String(err) }, 'could not listen for signals, retrying');
      setTimeout(() => void this.start(), 1000).unref();
    }
  }

  override close() {
    this.closed = true;
    const c = this.client;
    this.client = null;
    c?.release(true);
  }
}

/** What PGlite offers for LISTEN (typed here so core does not depend on PGlite). */
interface Listenable {
  listen(channel: string, cb: (payload: string) => void): Promise<() => Promise<void>>;
}

/** The same over PGlite, for tests: NOTIFY from a transaction reaches the streams like in production. */
export class PgliteSignals extends Signals {
  private unlisten: (() => Promise<void>) | null = null;

  constructor(private readonly client: Listenable) {
    super();
  }

  async start() {
    this.unlisten = await this.client.listen(SIGNAL_CHANNEL, (payload) => this.deliver(payload));
  }

  override close() {
    void this.unlisten?.();
  }
}
