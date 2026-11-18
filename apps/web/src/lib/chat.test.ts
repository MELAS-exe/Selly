import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureSession, newClientMessageId } from './chat';
import type { ChatMessage, ChatSession } from './chat-types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

const session = (over: Partial<ChatSession> = {}): ChatSession => ({
  session_token: 'tok_abc',
  conversation_id: 'conv-1',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  store: { slug: 'awa-style', display_name: 'Awa Style' },
  disclosure: 'Assistant automatique.',
  features: { voice_notes: false },
  messages: [],
  ...over,
});

describe('newClientMessageId', () => {
  it('is at least 8 characters and unique enough to never collide by accident', () => {
    const a = newClientMessageId();
    const b = newClientMessageId();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
    expect(a.startsWith('cm_')).toBe(true);
  });
});

describe('ensureSession', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates and stores a new session when there is none', async () => {
    const created = session();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(created), { status: 201 })),
    );

    const { session: s, resumed } = await ensureSession('awa-style');
    expect(resumed).toBe(false);
    expect(s.session_token).toBe('tok_abc');
    expect(JSON.parse(localStorage.getItem('selly:chat:awa-style') ?? '{}').session_token).toBe(
      'tok_abc',
    );
  });

  it('resumes a stored, unexpired session instead of creating a new one', async () => {
    localStorage.setItem(
      'selly:chat:awa-style',
      JSON.stringify({
        session_token: 'tok_old',
        conversation_id: 'conv-old',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        store: { slug: 'awa-style', display_name: 'Awa Style' },
        disclosure: 'Assistant automatique de Awa Style.',
        features: { voice_notes: false },
      }),
    );
    const history: ChatMessage[] = [
      {
        id: 'm1',
        conversation_id: 'conv-old',
        author: 'agent',
        author_label: 'Assistant',
        kind: 'text',
        text: 'Bonjour',
        cards: [],
        quick_replies: [],
        media_key: null,
        client_message_id: null,
        status: 'processed',
        created_at: new Date().toISOString(),
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: history })));
    vi.stubGlobal('fetch', fetchMock);

    const { session: s, resumed } = await ensureSession('awa-style');
    expect(resumed).toBe(true);
    expect(s.session_token).toBe('tok_old');
    expect(s.store.display_name).toBe('Awa Style');
    expect(s.disclosure).toBe('Assistant automatique de Awa Style.');
    expect(s.messages).toEqual(history);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/chat/messages'),
      expect.objectContaining({ headers: { authorization: 'Bearer tok_old' } }),
    );
  });

  it('starts a new session when the stored one has expired', async () => {
    localStorage.setItem(
      'selly:chat:awa-style',
      JSON.stringify({
        session_token: 'tok_expired',
        conversation_id: 'conv-old',
        expires_at: new Date(Date.now() - 1000).toISOString(),
        store: { slug: 'awa-style', display_name: 'Awa Style' },
        disclosure: 'Assistant automatique.',
        features: { voice_notes: false },
      }),
    );
    const created = session({ session_token: 'tok_new' });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/v1/chat/sessions');
      return new Response(JSON.stringify(created), { status: 201 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { session: s, resumed } = await ensureSession('awa-style');
    expect(resumed).toBe(false);
    expect(s.session_token).toBe('tok_new');
  });

  it('starts a new session when the server no longer recognises the stored token', async () => {
    localStorage.setItem(
      'selly:chat:awa-style',
      JSON.stringify({
        session_token: 'tok_revoked',
        conversation_id: 'conv-old',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        store: { slug: 'awa-style', display_name: 'Awa Style' },
        disclosure: 'Assistant automatique.',
        features: { voice_notes: false },
      }),
    );
    const created = session({ session_token: 'tok_new' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'CHAT_SESSION_EXPIRED' }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const { session: s, resumed } = await ensureSession('awa-style');
    expect(resumed).toBe(false);
    expect(s.session_token).toBe('tok_new');
  });
});
