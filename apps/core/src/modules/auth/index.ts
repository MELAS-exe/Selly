import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { isUuid } from '../catalog/store';
import {
  checkOrigin,
  clearSessionCookie,
  currentSession,
  requireSession,
  requireVendor,
  setSessionCookie,
} from './http';
import {
  addKey,
  claimChallenge,
  createSession,
  issueChallenge,
  listKeys,
  listSessions,
  ownerScope,
  removeKey,
  resolveSession,
  revokeSession,
  sessionInfo,
  stepUp,
  stepUpExpiresAt,
  vendorOfKey,
  vendorSummary,
} from './service';

// The event is checked by @selly/nostr; here only its outer shape is bounded.
const event = z.object({}).passthrough();
const challengeBody = z.strictObject({ purpose: z.enum(['sign_in', 'step_up', 'add_key']) });
const sessionBody = z.strictObject({
  challenge_id: z.string().max(64),
  event,
  device_label: z.string().trim().min(1).max(60).optional(),
});
const addKeyBody = z.strictObject({
  challenge_id: z.string().max(64),
  event,
  label: z.string().trim().min(1).max(60).optional(),
});
const introspectBody = z.strictObject({ session_cookie: z.string().max(128) });

/** Per IP: enough for a person signing in, not for a script trying keys. */
const AUTH_RATE = { rateLimit: { max: 20, timeWindow: '1 minute' } };

// Nostr sign-in, sessions and vendor keys (architecture.md section 5.2 group C and 5.3.2).
export const authModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  app.post('/api/v1/auth/nostr/challenges', { config: AUTH_RATE }, async (req, reply) => {
    checkOrigin(ctx(), req);
    const { purpose } = challengeBody.parse(req.body);
    const session = purpose === 'sign_in' ? null : await requireSession(ctx(), req);
    return reply.code(201).send(await issueChallenge(ctx(), purpose, session));
  });

  // Sign in (a new session and its cookie), or step up an open session. The challenge's purpose decides which.
  app.post('/api/v1/auth/nostr/sessions', { config: AUTH_RATE }, async (req, reply) => {
    checkOrigin(ctx(), req);
    const body = sessionBody.parse(req.body);
    const open = await currentSession(ctx(), req);
    const [c] = isUuid(body.challenge_id)
      ? await ctx()
          .db.select({ purpose: core.nostrChallenges.purpose })
          .from(core.nostrChallenges)
          .where(eq(core.nostrChallenges.id, body.challenge_id))
      : [];

    if (c?.purpose === 'step_up') {
      if (!open) throw new AppError('UNAUTHORIZED', 'Sign in first.');
      const s = await stepUp(ctx(), open, { challengeId: body.challenge_id, event: body.event });
      return { session: sessionInfo(s), vendor: await vendorSummary(ctx().db, s.vendorId) };
    }

    const pubkey = await claimChallenge(ctx(), {
      challengeId: body.challenge_id,
      event: body.event,
      purpose: 'sign_in',
      session: null,
    });
    const vendorId = await vendorOfKey(ctx().db, pubkey);
    const { session, token } = await createSession(ctx(), {
      pubkey,
      vendorId,
      deviceLabel: body.device_label,
    });
    setSessionCookie(ctx(), reply, token);
    return { session: sessionInfo(session), vendor: await vendorSummary(ctx().db, vendorId) };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const s = await requireSession(ctx(), req);
    await revokeSession(ctx().db, s.id, ctx().now());
    clearSessionCookie(ctx(), reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/auth/sessions', async (req) => {
    const s = await requireSession(ctx(), req);
    return { data: await listSessions(ctx(), s) };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/auth/sessions/:id', async (req, reply) => {
    const s = await requireSession(ctx(), req);
    if (!isUuid(req.params.id)) throw new AppError('NOT_FOUND', 'No such session.');
    const [target] = await ctx()
      .db.select({ id: core.vendorSessions.id })
      .from(core.vendorSessions)
      .where(and(eq(core.vendorSessions.id, req.params.id), ownerScope(s)));
    if (!target) throw new AppError('NOT_FOUND', 'No such session.');
    await revokeSession(ctx().db, target.id, ctx().now());
    if (target.id === s.id) clearSessionCookie(ctx(), reply);
    return reply.code(204).send();
  });

  app.get('/api/v1/vendors/me/keys', async (req) => {
    const s = await requireVendor(ctx(), req);
    return { data: await listKeys(ctx().db, s.vendorId) };
  });

  app.post('/api/v1/vendors/me/keys', { config: AUTH_RATE }, async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const body = addKeyBody.parse(req.body);
    return reply.code(201).send(
      await addKey(ctx(), s, {
        challengeId: body.challenge_id,
        event: body.event,
        label: body.label,
      }),
    );
  });

  app.delete<{ Params: { pubkey: string } }>(
    '/api/v1/vendors/me/keys/:pubkey',
    async (req, reply) => {
      const s = await requireVendor(ctx(), req);
      if (!/^[0-9a-f]{64}$/.test(req.params.pubkey))
        throw new AppError('NOT_FOUND', 'No such key.');
      await removeKey(ctx(), s, req.params.pubkey);
      return reply.code(204).send();
    },
  );

  // For the agent's inbox and assistant: one session system (architecture.md section 5.2 group F).
  app.post('/internal/v1/sessions/introspect', async (req) => {
    const { session_cookie } = introspectBody.parse(req.body);
    const s = await resolveSession(ctx(), session_cookie, { touch: false });
    return {
      valid: !!s,
      vendor_id: s?.vendorId ?? null,
      pubkey: s?.pubkey ?? null,
      step_up_expires_at: s ? iso(stepUpExpiresAt(s)) : null,
    };
  });
};
