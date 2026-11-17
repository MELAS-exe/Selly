import { core } from '@selly/db';
import { and, eq } from 'drizzle-orm';
import type { Context } from './context';
import { AppError } from './errors';
import { sha256Hex } from './util';

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );

/**
 * Run `fn` at most once per (scope, key) for 24 hours; a replay returns the stored response
 * (architecture.md section 5.1). The same key with a different body is IDEMPOTENCY_MISMATCH.
 * Failures are not stored, so a client can retry after fixing the cause.
 */
export async function withIdempotency<T>(
  ctx: Context,
  scope: string,
  key: string | undefined,
  body: unknown,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  if (!key || key.length < 16 || key.length > 64) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The Idempotency-Key header is required (16 to 64 characters).',
    );
  }
  const hash = Buffer.from(sha256Hex(stable(body)), 'hex');
  const t = core.idempotencyKeys;
  const claimed = await ctx.db
    .insert(t)
    .values({ scope, key, requestHash: hash })
    .onConflictDoNothing()
    .returning({ key: t.key });

  if (claimed.length === 0) {
    const [row] = await ctx.db
      .select()
      .from(t)
      .where(and(eq(t.scope, scope), eq(t.key, key)));
    if (!row) return withIdempotency(ctx, scope, key, body, fn); // deleted between the two statements
    if (!row.requestHash.equals(hash)) {
      throw new AppError(
        'IDEMPOTENCY_MISMATCH',
        'This Idempotency-Key was already used with a different request.',
      );
    }
    if (row.statusCode === null) {
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        'The first request with this key is still running.',
        {
          headers: { 'Retry-After': '2' },
        },
      );
    }
    return { status: row.statusCode, body: row.response as T, replayed: true };
  }

  try {
    const res = await fn();
    await ctx.db
      .update(t)
      .set({ statusCode: res.status, response: res.body })
      .where(and(eq(t.scope, scope), eq(t.key, key)));
    return { ...res, replayed: false };
  } catch (err) {
    await ctx.db.delete(t).where(and(eq(t.scope, scope), eq(t.key, key)));
    throw err;
  }
}
