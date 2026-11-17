// The HTTP side of vendor sessions: reading the cookie, the Origin check, and helpers for routes.
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Context } from '../../context';
import { AppError } from '../../errors';
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type Session } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    vendorSession?: Session | null;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * State-changing requests on cookie routes must come from our own pages (architecture.md section 5.1): the Origin
 * header must be the app's origin. SameSite=Lax already blocks most cross-site posts; this closes the rest.
 */
export function checkOrigin(ctx: Context, req: FastifyRequest) {
  if (!STATE_CHANGING.has(req.method)) return;
  const origin = req.headers.origin;
  if (origin !== new URL(ctx.config.APP_BASE_URL).origin) {
    throw new AppError(
      'FORBIDDEN',
      'This request must come from the Selly app (Origin header missing or wrong).',
    );
  }
}

/** The session of this request, or null. Cached on the request. */
export async function currentSession(ctx: Context, req: FastifyRequest): Promise<Session | null> {
  if (req.vendorSession !== undefined) return req.vendorSession;
  req.vendorSession = await resolveSession(ctx, req.cookies[SESSION_COOKIE]);
  return req.vendorSession;
}

export async function requireSession(ctx: Context, req: FastifyRequest): Promise<Session> {
  checkOrigin(ctx, req);
  const s = await currentSession(ctx, req);
  if (!s) throw new AppError('UNAUTHORIZED', 'Sign in with your Nostr key to continue.');
  return s;
}

/** A session that already has a shop. */
export async function requireVendor(
  ctx: Context,
  req: FastifyRequest,
): Promise<Session & { vendorId: string }> {
  const s = await requireSession(ctx, req);
  if (!s.vendorId) throw new AppError('NOT_FOUND', 'This key has no shop yet. Call POST /vendors.');
  return s as Session & { vendorId: string };
}

export function setSessionCookie(ctx: Context, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Browsers accept Secure cookies on http://localhost, but not on other plain-http hosts used in development.
    secure: ctx.config.APP_BASE_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(ctx: Context, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.APP_BASE_URL.startsWith('https://'),
  });
}
