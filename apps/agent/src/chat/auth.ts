// Authentication of the agent's callers (architecture.md section 5.1):
// chat bearer tokens, the vendor session cookie checked through core, the service token, and
// the HMAC signature of core events.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { CoreClient } from '../core/client';
import { AppError } from '../errors';
import { sha256 } from '../ids';
import type { AgentStore, ChatSessionRecord } from '../store/types';

export const CHAT_SESSION_DAYS = 30;

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Chat token: hash lookup, expiry after 30 days without activity (section 3.8). */
export async function authenticateChat(
  store: AgentStore,
  req: FastifyRequest,
): Promise<ChatSessionRecord> {
  const token = bearer(req);
  if (!token) throw new AppError('CHAT_SESSION_EXPIRED', 'Missing chat token.');
  const session = await store.findChatSessionByTokenHash(sha256(token));
  const now = Date.now();
  if (!session || session.expiresAt.getTime() <= now)
    throw new AppError('CHAT_SESSION_EXPIRED', 'Unknown or expired chat session.');
  // Sliding expiry; written at most once a minute.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await store.touchChatSession(session.id, new Date(now + CHAT_SESSION_DAYS * 86_400_000));
  }
  return session;
}

/** Vendor session: the `selly_session` cookie, checked by core and cached for 60 seconds (section 5.2 F). */
export class VendorAuth {
  private readonly cache = new Map<string, { vendorId: string | null; at: number }>();

  constructor(
    private readonly core: CoreClient,
    private readonly appBaseUrl: string,
    private readonly ttlMs = 60_000,
  ) {}

  async authenticate(req: FastifyRequest): Promise<string> {
    const cookie = readCookie(req.headers.cookie, 'selly_session');
    if (!cookie) throw new AppError('UNAUTHORIZED', 'Sign in first.');
    if (req.method !== 'GET' && req.method !== 'HEAD') this.checkOrigin(req);
    const key = sha256(cookie).toString('hex');
    const hit = this.cache.get(key);
    let vendorId: string | null;
    if (hit && Date.now() - hit.at < this.ttlMs) {
      vendorId = hit.vendorId;
    } else {
      try {
        const res = await this.core.introspectSession(cookie);
        vendorId = res.valid ? res.vendor_id : null;
      } catch {
        throw new AppError('PROVIDER_TIMEOUT', 'Session check unavailable.');
      }
      this.cache.set(key, { vendorId, at: Date.now() });
      if (this.cache.size > 10_000) this.cache.clear();
    }
    if (!vendorId) throw new AppError('UNAUTHORIZED', 'Sign in first.');
    return vendorId;
  }

  /** State-changing vendor requests must come from our own origin (section 5.1). */
  private checkOrigin(req: FastifyRequest) {
    const origin = req.headers.origin;
    const allowed = new URL(this.appBaseUrl).origin;
    if (origin !== allowed) throw new AppError('FORBIDDEN', 'Origin not allowed.');
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join('='));
    } catch {
      return null; // malformed encoding: treated as no session, not as a server error
    }
  }
  return null;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function checkServiceToken(req: FastifyRequest, expected: string) {
  const token = bearer(req);
  if (!token || !safeEqual(token, expected))
    throw new AppError('UNAUTHORIZED', 'Invalid service token.');
}

const TOLERANCE_S = 5 * 60;

/** `X-Selly-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 of `<t>.<raw body>`, 5 minutes of tolerance. */
export function verifyEventSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1 || Math.abs(nowS - t) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return safeEqual(expected, v1);
}

export function signEvent(
  rawBody: string,
  secret: string,
  t = Math.floor(Date.now() / 1000),
): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}
