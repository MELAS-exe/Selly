import { core } from '@selly/db';
import { and, count, eq, isNull } from '@selly/db/orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../errors';
import { iso } from '../../util';
import { requireVendor } from '../auth/http';
import { resolveSession, SESSION_COOKIE } from '../auth/service';
import { findVendorById, isUuid } from '../catalog/store';
import { latestNotificationId, notificationsAfter, notifyVendor } from './notifications';

const PING_MS = 20_000;
const MAX_PUSH_PER_VENDOR = 20;

const notificationBody = z.strictObject({
  type: z.enum(['conversation.handoff', 'conversation.new', 'usage.warning']),
  conversation_id: z.uuid().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(500).optional(),
  url: z
    .string()
    .max(300)
    .regex(/^\/app\//, 'A dashboard path, starting with /app/')
    .optional(),
});
const pushBody = z.strictObject({
  endpoint: z
    .url()
    .max(1000)
    .refine((u) => u.startsWith('https://'), 'The push endpoint must use https.'),
  keys: z.strictObject({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  expiration_time: z.number().int().positive().nullable().optional(),
});

// Outbox, notifications and the vendor's live stream (architecture.md sections 5.2 and 7.1).
export const eventsModule: FastifyPluginAsync = async (app) => {
  const ctx = () => app.ctx;

  // The dashboard's live stream. Starts from now (or Last-Event-ID); a `: ping` every 20 s keeps mobile networks
  // open; the session is checked again every minute, so a signed-out device stops receiving.
  app.get('/api/v1/vendors/me/events', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const lastEventId = req.headers['last-event-id'];
    let cursor =
      typeof lastEventId === 'string' && isUuid(lastEventId)
        ? lastEventId
        : await latestNotificationId(ctx().db, s.vendorId);
    const cookie = req.cookies[SESSION_COOKIE];

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let closed = false;
    let busy = false;
    let again = false;
    let lastWrite = Date.now();
    let lastCheck = Date.now();
    const stop = () => {
      closed = true;
      clearInterval(timer);
      off();
      if (!res.writableEnded) res.end();
    };
    const tick = async (): Promise<void> => {
      if (closed) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        if (Date.now() - lastCheck >= ctx().config.VENDOR_STREAM_SESSION_CHECK_MS) {
          lastCheck = Date.now();
          const still = await resolveSession(ctx(), cookie, { touch: false });
          if (!still || still.vendorId !== s.vendorId) return stop();
        }
        const rows = await notificationsAfter(ctx().db, s.vendorId, cursor);
        for (const n of rows) {
          res.write(
            `event: ${n.type}\nid: ${n.id}\ndata: ${JSON.stringify({ ...n.data, at: iso(n.createdAt) })}\n\n`,
          );
          cursor = n.id;
          lastWrite = Date.now();
        }
        if (Date.now() - lastWrite >= PING_MS) {
          res.write(': ping\n\n');
          lastWrite = Date.now();
        }
      } catch {
        stop();
      } finally {
        busy = false;
      }
      if (again) {
        again = false;
        return tick();
      }
    };
    // Wakes at once on a new notification for this vendor (LISTEN/NOTIFY); the poll is the fallback, and also
    // drives the pings and the session check.
    const timer = setInterval(tick, ctx().config.SSE_POLL_MS);
    const off = ctx().signals.on('vendor', s.vendorId, () => void tick());
    req.raw.on('close', stop);
    await tick();
  });

  // A browser allowed Web Push. The endpoint is unique per browser: re-registering moves it to this vendor.
  // Sending comes with the notification worker; the subscription is kept now so nothing is lost.
  app.post('/api/v1/vendors/me/push-subscriptions', async (req, reply) => {
    const s = await requireVendor(ctx(), req);
    const body = pushBody.parse(req.body);
    const t = core.pushSubscriptions;
    const [{ n } = { n: 0 }] = await ctx()
      .db.select({ n: count() })
      .from(t)
      .where(and(eq(t.vendorId, s.vendorId), isNull(t.revokedAt)));
    if (n >= MAX_PUSH_PER_VENDOR) {
      throw new AppError(
        'VALIDATION_FAILED',
        `At most ${MAX_PUSH_PER_VENDOR} browsers can receive notifications.`,
      );
    }
    const values = {
      vendorId: s.vendorId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      expirationTime: body.expiration_time ? new Date(body.expiration_time) : null,
      revokedAt: null,
      lastError: null,
    };
    const [row] = await ctx()
      .db.insert(t)
      .values(values)
      .onConflictDoUpdate({ target: t.endpoint, set: values })
      .returning();
    return reply
      .code(201)
      .send({ id: row?.id, endpoint: row?.endpoint, created_at: iso(row?.createdAt) });
  });

  // The agent asks core to alert the vendor: a chat handed over, a new chat, a quota warning.
  app.post<{ Params: { id: string } }>(
    '/internal/v1/vendors/:id/notifications',
    async (req, reply) => {
      const body = notificationBody.parse(req.body);
      const vendor = await findVendorById(ctx(), req.params.id);
      await notifyVendor(ctx().db, {
        vendorId: vendor.id,
        type: body.type,
        data: {
          title: body.title,
          ...(body.body ? { body: body.body } : {}),
          ...(body.url ? { url: body.url } : {}),
          ...(body.conversation_id ? { conversation_id: body.conversation_id } : {}),
        },
        now: ctx().now(),
        // At most one alert per conversation (or per type) every 5 minutes.
        dedupeKey: `${body.type}:${body.conversation_id ?? '-'}`,
      });
      return reply.code(202).send();
    },
  );
};
