// A streaming pass-through to the agent's SSE endpoint. The generic rewrite in next.config.ts
// buffers a proxied response instead of streaming it (confirmed locally: the first byte never
// arrives through next dev's rewrite), so this one route forwards the response stream directly
// instead of going through rewrites().
export const dynamic = 'force-dynamic';

const AGENT_URL = process.env.AGENT_URL ?? 'http://localhost:4100';

export async function GET(req: Request) {
  const upstream = await fetch(`${AGENT_URL}/api/v1/chat/events`, {
    headers: {
      authorization: req.headers.get('authorization') ?? '',
      accept: 'text/event-stream',
      ...(req.headers.get('last-event-id')
        ? { 'last-event-id': req.headers.get('last-event-id') as string }
        : {}),
    },
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
