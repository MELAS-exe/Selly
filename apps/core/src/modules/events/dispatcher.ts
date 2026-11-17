// Delivers the outbox to the agent (architecture.md sections 5.1 and 7.1): a signed HTTP POST per event, at least
// once, in order per key (the order id). The agent ignores an event_id it has already seen.
// Runs as a single instance, like the reconciler; with several core instances, elect one with an advisory lock.
import { createHmac } from 'node:crypto';
import { core } from '@selly/db';
import { and, asc, eq, isNull, lt, lte, sql } from '@selly/db/orm';
import type { Context } from '../../context';

const { outbox } = core;

/** Delay before attempt n+1 after n failures. After the last one the event is a dead letter. */
export const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000, 3_600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const BATCH = 50;
const TIMEOUT_MS = 5_000;

/** `t=<unix>,v1=<hex>`: HMAC-SHA256 of `<t>.<raw body>`. The agent allows 5 minutes of clock difference. */
export function signEvent(secret: string, body: string, unixSeconds: number): string {
  return `t=${unixSeconds},v1=${createHmac('sha256', secret).update(`${unixSeconds}.${body}`).digest('hex')}`;
}

export interface DispatchDeps {
  agentUrl: string;
  secret: string;
  fetch?: typeof fetch;
}

/**
 * One pass: send every due event whose key has no older undelivered event, oldest first. A failure for one key
 * holds back that key only. Dead letters (MAX_ATTEMPTS reached) no longer hold their key back.
 */
export async function dispatchOnce(ctx: Pick<Context, 'db' | 'now' | 'log'>, deps: DispatchDeps) {
  const now = ctx.now();
  const older = sql`exists (
    select 1 from core.outbox o2
    where o2.key = ${outbox.key} and o2.published_at is null and o2.attempts < ${MAX_ATTEMPTS} and o2.id < ${outbox.id}
  )`;
  const due = await ctx.db
    .select()
    .from(outbox)
    .where(
      and(
        isNull(outbox.publishedAt),
        lt(outbox.attempts, MAX_ATTEMPTS),
        lte(outbox.nextAttemptAt, now),
        sql`not ${older}`,
      ),
    )
    .orderBy(asc(outbox.id))
    .limit(BATCH);

  const blocked = new Set<string>();
  let sent = 0;
  let failed = 0;
  for (const e of due) {
    if (blocked.has(e.key)) continue;
    const body = JSON.stringify(e.payload);
    let error: string | null = null;
    try {
      const res = await (deps.fetch ?? fetch)(`${deps.agentUrl}/internal/v1/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-selly-signature': signEvent(deps.secret, body, Math.floor(Date.now() / 1000)),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) error = `agent answered ${res.status}`;
    } catch (err) {
      error = `agent unreachable: ${(err as Error).message}`;
    }

    if (!error) {
      await ctx.db
        .update(outbox)
        .set({ publishedAt: ctx.now(), lastError: null })
        .where(eq(outbox.id, e.id));
      sent++;
      continue;
    }
    failed++;
    blocked.add(e.key);
    const attempts = e.attempts + 1;
    const delay = BACKOFF_MS[attempts - 1];
    await ctx.db
      .update(outbox)
      .set({
        attempts,
        lastError: error.slice(0, 300),
        nextAttemptAt:
          delay === undefined ? e.nextAttemptAt : new Date(ctx.now().getTime() + delay),
      })
      .where(eq(outbox.id, e.id));
    if (attempts >= MAX_ATTEMPTS) {
      ctx.log.error(
        { eventId: e.id, topic: e.topic, key: e.key, error },
        'event dead-lettered: the agent never accepted it',
      );
    }
  }
  return { sent, failed };
}
