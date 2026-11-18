// The customer chat widget's client (architecture.md 3.8): one session per shop, kept in
// localStorage, SSE for live replies with a polling fallback if the stream drops.
import type { ChatMessage, ChatSession } from './chat-types';

const TOKEN_KEY = (slug: string) => `selly:chat:${slug}`;

interface StoredSession {
  session_token: string;
  conversation_id: string;
  expires_at: string;
  store: { slug: string; display_name: string };
  disclosure: string;
  features: { voice_notes: boolean };
}

function readStored(slug: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.session_token || new Date(parsed.expires_at).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(slug: string, s: ChatSession) {
  try {
    localStorage.setItem(
      TOKEN_KEY(slug),
      JSON.stringify({
        session_token: s.session_token,
        conversation_id: s.conversation_id,
        expires_at: s.expires_at,
        store: s.store,
        disclosure: s.disclosure,
        features: s.features,
      } satisfies StoredSession),
    );
  } catch {
    // Private mode or full storage: the chat still works, just signs in again on reload.
  }
}

export class ChatError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ChatError';
  }
}

async function parseError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { code?: string; detail?: string } | null;
  throw new ChatError(body?.code ?? 'UNKNOWN', body?.detail);
}

/**
 * The widget's session: a stored, unexpired token if there is one, otherwise a new session
 * (optionally with a product attached, so the greeting and the agent's first turn know it).
 */
export async function ensureSession(
  slug: string,
  opts: { productId?: string; reuse?: boolean } = {},
): Promise<{ session: ChatSession; resumed: boolean }> {
  const stored = opts.reuse === false ? null : readStored(slug);
  if (stored) {
    const res = await fetch('/api/v1/chat/messages?limit=100', {
      headers: { authorization: `Bearer ${stored.session_token}` },
    });
    if (res.ok) {
      const page = (await res.json()) as { data: ChatMessage[] };
      return {
        session: {
          session_token: stored.session_token,
          conversation_id: stored.conversation_id,
          expires_at: stored.expires_at,
          store: stored.store,
          disclosure: stored.disclosure,
          features: stored.features,
          messages: page.data,
        },
        resumed: true,
      };
    }
    // Expired or revoked on the server: fall through to a new session.
  }
  const res = await fetch('/api/v1/chat/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ store_slug: slug, product_id: opts.productId }),
  });
  if (!res.ok) await parseError(res);
  const session = (await res.json()) as ChatSession;
  writeStored(slug, session);
  return { session, resumed: false };
}

/** A random, URL-safe id: client_message_id, so a retried POST never creates a second message. */
export function newClientMessageId(): string {
  return `cm_${crypto.randomUUID().replace(/-/g, '')}`;
}

export async function sendMessage(
  token: string,
  body: {
    client_message_id: string;
    text: string;
    quick_reply_id?: string;
    context?: { product_id?: string };
  },
): Promise<ChatMessage> {
  const res = await fetch('/api/v1/chat/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: 'text', ...body }),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as ChatMessage;
}

export async function listMessages(token: string, after?: string): Promise<ChatMessage[]> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : '';
  const res = await fetch(`/api/v1/chat/messages${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) await parseError(res);
  const page = (await res.json()) as { data: ChatMessage[] };
  return page.data;
}

export type ChatLiveEvent =
  | { event: 'message'; data: ChatMessage }
  | { event: 'typing'; data: { on: boolean } }
  | { event: 'mode'; data: { mode: 'bot' | 'human'; by: string; label?: string } };

/**
 * Live updates for one conversation, over `fetch` streaming: `EventSource` cannot set the
 * Authorization header this stream needs (docs/api.json, streamChatEvents). Falls back to a
 * 5-second poll once the stream has failed twice in a row (a proxy that buffers it, a flaky
 * network). Returns a function that stops everything.
 */
export function subscribe(
  token: string,
  lastMessageId: string | undefined,
  onEvent: (e: ChatLiveEvent) => void,
): () => void {
  let closed = false;
  let abort: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let cursor = lastMessageId;

  function dispatch(event: string, raw: string) {
    try {
      const data = JSON.parse(raw);
      if (event === 'message' || event === 'typing' || event === 'mode')
        onEvent({ event, data } as ChatLiveEvent);
    } catch {
      // malformed event: ignored, the next one carries on
    }
  }

  function startPolling() {
    const tick = async () => {
      if (closed) return;
      try {
        const msgs = await listMessages(token, cursor);
        for (const m of msgs) {
          cursor = m.id;
          onEvent({ event: 'message', data: m });
        }
      } catch {
        // A network blip during polling is not fatal: the next tick retries.
      }
      if (!closed) pollTimer = setTimeout(tick, 5000);
    };
    void tick();
  }

  async function startStream() {
    abort = new AbortController();
    try {
      const res = await fetch('/api/v1/chat/events', {
        headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      failures = 0;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let eventName = 'message';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dispatch(eventName, line.slice(5).trim());
          else if (line === '') eventName = 'message'; // blank line ends one SSE record
        }
      }
      if (!closed) throw new Error('stream ended');
    } catch {
      if (closed) return;
      failures += 1;
      if (failures >= 2) startPolling();
      else setTimeout(startStream, 1000);
    }
  }

  void startStream();

  return () => {
    closed = true;
    abort?.abort();
    if (pollTimer) clearTimeout(pollTimer);
  };
}
