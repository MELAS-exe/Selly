// A streaming pass-through to core's dashboard stream (GET /api/v1/vendors/me/events). The generic rewrite in
// next.config.ts buffers a proxied response instead of streaming it (see ../../../chat/events/route.ts), so this
// route forwards the stream itself, with the vendor's session cookie.
export const dynamic = 'force-dynamic';

const CORE_URL = process.env.CORE_URL ?? 'http://localhost:4000';

export async function GET(req: Request) {
  const lastEventId = req.headers.get('last-event-id');
  const upstream = await fetch(`${CORE_URL}/api/v1/vendors/me/events`, {
    headers: {
      cookie: req.headers.get('cookie') ?? '',
      accept: 'text/event-stream',
      ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
    },
    signal: req.signal,
    // @ts-expect-error -- undici-only, drops Node's response buffering for this request.
    duplex: 'half',
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-store',
    },
  });
}
