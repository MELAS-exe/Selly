// Test harness: the agent with the in-memory store, the fake core and a scripted model.

import { buildApp } from './app';
import { type AsrProvider, NoAsr } from './asr';
import { signEvent } from './chat/auth';
import { FAKE_VENDOR_ID, FAKE_VENDOR_SESSION, FakeCore } from './core/fake';
import { ScriptedProvider } from './engine/scripted';
import { MemoryStore } from './store/memory';
import type { ImageResolver } from './vision';

export const APP = 'http://localhost:3000';
export { FAKE_VENDOR_ID, FAKE_VENDOR_SESSION };

export function setup(
  opts: { asr?: AsrProvider; imageResolver?: ImageResolver; mergeWindowMs?: number } = {},
) {
  const store = new MemoryStore();
  const core = new FakeCore(APP);
  const llm = new ScriptedProvider();
  const app = buildApp({
    store,
    core,
    llm,
    asr: opts.asr ?? new NoAsr(),
    imageResolver: opts.imageResolver,
    config: {
      appBaseUrl: APP,
      mergeWindowMs: opts.mergeWindowMs ?? 0,
      turnDeadlineMs: 5_000,
      databaseUrl: '',
      coreUrl: '',
      eventsHmacSecret: 'test-secret',
      serviceToken: 'test-token',
      testEndpoint: true,
    },
  });

  async function openChat(slug = 'awa-style') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/sessions',
      payload: { store_slug: slug },
    });
    const body = res.json();
    return {
      res,
      token: body.session_token as string,
      conversationId: body.conversation_id as string,
      body,
    };
  }

  let seq = 0;
  async function send(token: string, text: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { client_message_id: `msg-${Date.now()}-${++seq}`, kind: 'text', text, ...extra },
    });
    await app.services.turns.idle();
    return res;
  }

  async function history(token: string) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/chat/messages?limit=100',
      headers: { authorization: `Bearer ${token}` },
    });
    return res.json().data as {
      id: string;
      author: string;
      author_label: string | null;
      text: string | null;
      cards: { type: string; [k: string]: unknown }[];
      quick_replies: { id: string; label: string }[];
      status: string;
    }[];
  }

  async function postEvent(event: Record<string, unknown>, secret = 'test-secret') {
    const raw = JSON.stringify(event);
    return app.inject({
      method: 'POST',
      url: '/internal/v1/events',
      headers: { 'content-type': 'application/json', 'x-selly-signature': signEvent(raw, secret) },
      payload: raw,
    });
  }

  const vendorHeaders = { cookie: `selly_session=${FAKE_VENDOR_SESSION}`, origin: APP };

  return { app, store, core, llm, openChat, send, history, postEvent, vendorHeaders };
}

/** The variant id of a fake product option, e.g. the black wax dress in 42. */
export function variantOf(core: FakeCore, slug: string, size?: string) {
  const p = core.products.find((x) => x.slug === slug);
  const v = p?.variants.find((x) => !size || x.options.size === size);
  if (!v) throw new Error(`no variant ${slug} ${size}`);
  return v.id;
}
