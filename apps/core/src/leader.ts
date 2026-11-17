// One leader among core processes, for the work that must run once: the reconciler, the outbox dispatcher, the
// subscription and housekeeping jobs, wallet notification subscriptions and the pairing watcher
// (architecture.md section 3.6: "elected with a PostgreSQL advisory lock"). HTTP requests run on every process.
//
// The lock is a session-level advisory lock held on a dedicated connection: it lasts as long as that connection.
// If the connection breaks, PostgreSQL releases the lock and another process takes it on its next try.
import type pg from 'pg';
import type { Logger } from './context';

/** A fixed 64-bit key for pg_try_advisory_lock: "selly jobs". */
export const JOBS_LOCK_KEY = 7_264_812_031_337n;
const RETRY_MS = 10_000;

export interface Leader {
  isLeader(): boolean;
  close(): void;
}

/** A single process, or tests: always the leader. */
export const soleLeader: Leader = { isLeader: () => true, close: () => {} };

export class PgLeader implements Leader {
  private client: pg.PoolClient | null = null;
  private leading = false;
  private closed = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly log: Logger,
    private readonly onChange: (leading: boolean) => void = () => {},
  ) {}

  isLeader() {
    return this.leading;
  }

  /** Tries now, then every 10 seconds while another process leads. */
  async start() {
    await this.tryLead();
    this.timer = setInterval(() => void this.tryLead(), RETRY_MS);
    this.timer.unref();
  }

  /** One attempt: keeps the lock if held, takes it if free. Public for tests. */
  async tryLead() {
    if (this.closed) return;
    try {
      if (this.leading && this.client) {
        // Still connected? A dead connection means the lock is gone.
        await this.client.query('select 1');
        return;
      }
      if (!this.client) {
        const client = await this.pool.connect();
        client.on('error', (err) => this.lose(String(err)));
        this.client = client;
      }
      const { rows } = await this.client.query<{ ok: boolean }>(
        'select pg_try_advisory_lock($1) as ok',
        [JOBS_LOCK_KEY.toString()],
      );
      if (rows[0]?.ok) this.set(true);
    } catch (err) {
      this.lose(String(err));
    }
  }

  private set(leading: boolean) {
    if (this.leading === leading) return;
    this.leading = leading;
    this.log.info({ leading }, leading ? 'this process now runs the jobs' : 'job leadership lost');
    this.onChange(leading);
  }

  private lose(reason: string) {
    if (this.client) {
      this.client.release(true);
      this.client = null;
    }
    if (this.leading) this.log.warn({ reason }, 'job leader connection lost');
    this.set(false);
  }

  close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    // Releasing the connection releases the lock: another process takes over within 10 seconds.
    this.client?.release(true);
    this.client = null;
    this.leading = false;
  }
}
