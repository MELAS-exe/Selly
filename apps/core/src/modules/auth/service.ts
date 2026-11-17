// Vendor identity with a Nostr key (architecture.md ADR-03 and section 5.3.2).
// A challenge is random, single-use and valid 5 minutes. A session is a random cookie value stored only as a hash,
// valid 30 days and extended while it is used. A step-up is a fresh signature, valid 10 minutes, required to change
// the wallet or the keys.
import { randomBytes } from 'node:crypto';
import { core } from '@selly/db';
import { and, eq, gt, isNull, lt } from '@selly/db/orm';
import {
  CHALLENGE_TTL_SECONDS,
  eventTemplate,
  MAX_KEYS_PER_VENDOR,
  STEP_UP_TTL_SECONDS,
  verifyAuthEvent,
} from '@selly/nostr';
import type { Context, Database } from '../../context';
import { AppError } from '../../errors';
import { iso, sha256Hex } from '../../util';
import { isUuid } from '../catalog/store';
import { audit } from '../events/outbox';

const { nostrChallenges: ch, vendorSessions: vs, vendorKeys: vk, vendors } = core;

export const SESSION_COOKIE = 'selly_session';
export const SESSION_TTL_MS = 30 * 86_400_000;
/** A session is extended at most once an hour, to keep reads cheap. */
const TOUCH_EVERY_MS = 3_600_000;

export type Purpose = 'sign_in' | 'step_up' | 'add_key';
export type Session = typeof vs.$inferSelect;

const hashToken = (token: string) => Buffer.from(sha256Hex(token), 'hex');

/** The URL a challenge's event must name: where it will be sent. */
export function challengeUrl(appBaseUrl: string, purpose: Purpose): string {
  return purpose === 'add_key'
    ? `${appBaseUrl}/api/v1/vendors/me/keys`
    : `${appBaseUrl}/api/v1/auth/nostr/sessions`;
}

export async function issueChallenge(ctx: Context, purpose: Purpose, session: Session | null) {
  if (purpose !== 'sign_in' && !session) throw new AppError('UNAUTHORIZED', 'Sign in first.');
  const now = ctx.now();
  const challenge = randomBytes(32).toString('hex');
  const [row] = await ctx.db
    .insert(ch)
    .values({
      challenge,
      purpose,
      sessionId: purpose === 'sign_in' ? null : (session as Session).id,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000),
    })
    .returning();
  const c = row as typeof ch.$inferSelect;
  return {
    challenge_id: c.id,
    challenge,
    purpose,
    expires_at: iso(c.expiresAt) as string,
    event_template: eventTemplate({
      url: challengeUrl(ctx.config.APP_BASE_URL, purpose),
      method: 'POST',
      challenge,
      now: Math.floor(now.getTime() / 1000),
    }),
  };
}

/**
 * Checks the signed event against its challenge, then claims the challenge in one conditional update, so a replay
 * (or two requests racing) finds nothing. Returns the signer's public key.
 */
export async function claimChallenge(
  ctx: Context,
  input: { challengeId: string; event: unknown; purpose: Purpose; session: Session | null },
): Promise<string> {
  const invalid = (reason: string) => {
    ctx.log.info({ reason, purpose: input.purpose }, 'sign-in challenge refused');
    return new AppError(
      'CHALLENGE_INVALID',
      'The challenge was already used, has expired, or the signature does not match.',
    );
  };
  if (!isUuid(input.challengeId)) throw invalid('unknown_challenge');
  const now = ctx.now();
  const [row] = await ctx.db.select().from(ch).where(eq(ch.id, input.challengeId));
  if (!row || row.usedAt || row.expiresAt <= now) throw invalid('used_or_expired');
  if (row.purpose !== input.purpose) throw invalid('wrong_purpose');
  if (row.purpose !== 'sign_in' && row.sessionId !== input.session?.id)
    throw invalid('other_session');

  const check = verifyAuthEvent(input.event, {
    url: challengeUrl(ctx.config.APP_BASE_URL, row.purpose),
    method: 'POST',
    challenge: row.challenge,
    now: Math.floor(now.getTime() / 1000),
  });
  if (!check.ok) throw invalid(check.reason);

  const claimed = await ctx.db
    .update(ch)
    .set({ usedAt: now })
    .where(and(eq(ch.id, row.id), isNull(ch.usedAt), gt(ch.expiresAt, now)))
    .returning({ id: ch.id });
  if (claimed.length === 0) throw invalid('used_or_expired');
  return check.pubkey;
}

/** The vendor a key belongs to, if it is a live key. */
export async function vendorOfKey(db: Database, pubkey: string): Promise<string | null> {
  const [k] = await db
    .select()
    .from(vk)
    .where(and(eq(vk.pubkey, pubkey), isNull(vk.revokedAt)));
  return k?.vendorId ?? null;
}

export async function createSession(
  ctx: Context,
  input: { pubkey: string; vendorId: string | null; deviceLabel?: string | undefined },
) {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  const [row] = await ctx.db
    .insert(vs)
    .values({
      pubkey: input.pubkey,
      vendorId: input.vendorId,
      tokenHash: hashToken(token),
      deviceLabel: input.deviceLabel ?? null,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();
  if (input.vendorId) {
    await ctx.db.update(vk).set({ lastUsedAt: now }).where(eq(vk.pubkey, input.pubkey));
  }
  return { session: row as Session, token };
}

/** The live session behind a cookie value, extended when it is used. Null when unknown, revoked or expired. */
export async function resolveSession(
  ctx: Pick<Context, 'db' | 'now'>,
  token: string | undefined,
  opts: { touch?: boolean } = {},
) {
  if (!token || token.length > 128) return null;
  const now = ctx.now();
  const [row] = await ctx.db
    .select()
    .from(vs)
    .where(and(eq(vs.tokenHash, hashToken(token)), isNull(vs.revokedAt), gt(vs.expiresAt, now)));
  if (!row) return null;
  if (opts.touch !== false && now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await ctx.db.update(vs).set({ lastSeenAt: now, expiresAt }).where(eq(vs.id, row.id));
    return { ...row, lastSeenAt: now, expiresAt };
  }
  return row;
}

export function stepUpExpiresAt(s: Session): Date | null {
  return s.stepUpAt ? new Date(s.stepUpAt.getTime() + STEP_UP_TTL_SECONDS * 1000) : null;
}

export function requireStepUp(ctx: Pick<Context, 'now'>, s: Session) {
  const until = stepUpExpiresAt(s);
  if (!until || until <= ctx.now()) {
    throw new AppError(
      'STEP_UP_REQUIRED',
      "Confirmez d'abord avec votre clé Nostr : cette action demande une signature de moins de 10 minutes.",
    );
  }
}

/** A step-up must be signed by a key of this session's vendor (or by the session's own key before a shop exists). */
export async function stepUp(
  ctx: Context,
  session: Session,
  input: { challengeId: string; event: unknown },
) {
  const pubkey = await claimChallenge(ctx, { ...input, purpose: 'step_up', session });
  const allowed = session.vendorId
    ? (await vendorOfKey(ctx.db, pubkey)) === session.vendorId
    : pubkey === session.pubkey;
  if (!allowed) {
    ctx.log.info({ sessionId: session.id }, 'step-up signed by a key of another vendor');
    throw new AppError('CHALLENGE_INVALID', 'This key does not belong to your shop.');
  }
  const now = ctx.now();
  const [row] = await ctx.db
    .update(vs)
    .set({ stepUpAt: now, lastSeenAt: now })
    .where(eq(vs.id, session.id))
    .returning();
  return row as Session;
}

export function sessionInfo(s: Session) {
  return {
    id: s.id,
    pubkey: s.pubkey,
    created_at: iso(s.createdAt) as string,
    expires_at: iso(s.expiresAt) as string,
    step_up_expires_at: iso(stepUpExpiresAt(s)),
  };
}

export async function vendorSummary(db: Database, vendorId: string | null) {
  if (!vendorId) return null;
  const [v] = await db.select().from(vendors).where(eq(vendors.id, vendorId));
  return v ? { id: v.id, display_name: v.displayName, slug: v.slug, status: v.status } : null;
}

export async function revokeSession(db: Database, id: string, now: Date) {
  await db
    .update(vs)
    .set({ revokedAt: now })
    .where(and(eq(vs.id, id), isNull(vs.revokedAt)));
}

/** Sessions of the same owner: the vendor, or the key before a shop exists. */
export const ownerScope = (s: Session) =>
  s.vendorId ? eq(vs.vendorId, s.vendorId) : and(eq(vs.pubkey, s.pubkey), isNull(vs.vendorId));

export async function listSessions(ctx: Context, s: Session) {
  const now = ctx.now();
  const rows = await ctx.db
    .select()
    .from(vs)
    .where(and(ownerScope(s), isNull(vs.revokedAt), gt(vs.expiresAt, now)));
  return rows
    .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .map((r) => ({
      id: r.id,
      device_label: r.deviceLabel,
      created_at: iso(r.createdAt) as string,
      last_seen_at: iso(r.lastSeenAt) as string,
      current: r.id === s.id,
    }));
}

// ---------------------------------------------------------------------------------------------- vendor keys

export const keyView = (k: typeof vk.$inferSelect) => ({
  pubkey: k.pubkey,
  label: k.label,
  created_at: iso(k.createdAt) as string,
  last_used_at: iso(k.lastUsedAt),
});

export async function listKeys(db: Database, vendorId: string) {
  const rows = await db
    .select()
    .from(vk)
    .where(and(eq(vk.vendorId, vendorId), isNull(vk.revokedAt)));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(keyView);
}

/**
 * Adds a key: needs a step-up, and a challenge of purpose add_key signed by the new key, so nobody can attach a
 * key they do not hold. At most three live keys.
 */
export async function addKey(
  ctx: Context,
  s: Session,
  input: { challengeId: string; event: unknown; label?: string | undefined },
) {
  const vendorId = s.vendorId as string;
  requireStepUp(ctx, s);
  const pubkey = await claimChallenge(ctx, {
    challengeId: input.challengeId,
    event: input.event,
    purpose: 'add_key',
    session: s,
  });
  const now = ctx.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(vk).where(eq(vk.pubkey, pubkey));
    if (existing && (existing.vendorId !== vendorId || !existing.revokedAt)) {
      throw new AppError(
        'VALIDATION_FAILED',
        existing.vendorId === vendorId
          ? 'This key is already one of your keys.'
          : 'This key belongs to another shop.',
        {
          errors: [{ field: 'event.pubkey', message: 'Already registered' }],
        },
      );
    }
    const live = await tx
      .select({ pubkey: vk.pubkey })
      .from(vk)
      .where(and(eq(vk.vendorId, vendorId), isNull(vk.revokedAt)))
      .for('update');
    if (live.length >= MAX_KEYS_PER_VENDOR) {
      throw new AppError(
        'VALIDATION_FAILED',
        `A shop can have at most ${MAX_KEYS_PER_VENDOR} keys.`,
        {
          errors: [{ limit: 'keys', max: MAX_KEYS_PER_VENDOR }],
        },
      );
    }
    const [k] = existing
      ? await tx
          .update(vk)
          .set({
            revokedAt: null,
            label: input.label ?? existing.label,
            createdAt: now,
            lastUsedAt: null,
          })
          .where(eq(vk.pubkey, pubkey))
          .returning()
      : await tx
          .insert(vk)
          .values({ pubkey, vendorId, label: input.label ?? null, createdAt: now })
          .returning();
    await audit(tx, {
      actor: `vendor:${vendorId}`,
      action: 'key.added',
      target: vendorId,
      details: { pubkey },
    });
    return k as typeof vk.$inferSelect;
  });
  return keyView(row);
}

/** Removes a key (step-up). The last key cannot go. Sessions opened with it end. */
export async function removeKey(ctx: Context, s: Session, pubkey: string) {
  const vendorId = s.vendorId as string;
  requireStepUp(ctx, s);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const live = await tx
      .select()
      .from(vk)
      .where(and(eq(vk.vendorId, vendorId), isNull(vk.revokedAt)))
      .for('update');
    if (!live.some((k) => k.pubkey === pubkey)) throw new AppError('NOT_FOUND', 'No such key.');
    if (live.length <= 1) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The last key cannot be removed. Add another key first.',
      );
    }
    await tx.update(vk).set({ revokedAt: now }).where(eq(vk.pubkey, pubkey));
    await tx
      .update(vs)
      .set({ revokedAt: now })
      .where(and(eq(vs.vendorId, vendorId), eq(vs.pubkey, pubkey), isNull(vs.revokedAt)));
    await audit(tx, {
      actor: `vendor:${vendorId}`,
      action: 'key.removed',
      target: vendorId,
      details: { pubkey },
    });
  });
}

/** Challenges are useless a day after they expire. */
export async function purgeOldChallenges(db: Database, now: Date) {
  await db.delete(ch).where(lt(ch.expiresAt, new Date(now.getTime() - 86_400_000)));
}
