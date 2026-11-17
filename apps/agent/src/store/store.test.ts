// One contract, three stores: memory, PostgreSQL in-process (PGlite, every migration applied),
// and a real PostgreSQL 18 when TEST_DATABASE_URL points to a migrated database:
//   pnpm infra:up && pnpm --filter @selly/db db:migrate
//   TEST_DATABASE_URL=postgres://selly:selly@localhost:5432/selly pnpm --filter @selly/agent test
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@selly/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../ids';
import { MemoryStore } from './memory';
import { PostgresStore } from './postgres';
import type { AgentStore } from './types';

let pglite: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  pglite = await createTestDb();
}, 60_000);

const pgUrl = process.env.TEST_DATABASE_URL;
const opened: PostgresStore[] = [];
const stores: [string, () => AgentStore][] = [
  ['memory', () => new MemoryStore()],
  ['pglite', () => new PostgresStore(pglite.db)],
];
if (pgUrl)
  stores.push([
    'postgres',
    () => {
      const s = PostgresStore.connect(pgUrl);
      opened.push(s);
      return s;
    },
  ]);

afterAll(async () => {
  await Promise.all(opened.map((s) => s.close()));
  await pglite?.close();
});

describe.each(stores)('%s store', (_name, make) => {
  const vendorId = () => randomUUID();

  it('upserts a conversation once per (vendor, channel, user)', async () => {
    const store = make();
    const v = vendorId();
    const a = await store.upsertConversation({
      vendorId: v,
      channel: 'web',
      role: 'customer',
      externalUserId: 'u1',
    });
    const b = await store.upsertConversation({
      vendorId: v,
      channel: 'web',
      role: 'customer',
      externalUserId: 'u1',
    });
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ mode: 'bot', summary: '', state: {} });
    const updated = await store.updateConversation(a.id, {
      mode: 'human',
      state: { cart: [{ variant_id: 'x', quantity: 1 }] },
    });
    expect(updated.mode).toBe('human');
    expect((await store.getConversation(a.id))?.state.cart).toEqual([
      { variant_id: 'x', quantity: 1 },
    ]);
  });

  it('stores messages idempotently by client_message_id, in order', async () => {
    const store = make();
    const c = await store.upsertConversation({
      vendorId: vendorId(),
      channel: 'web',
      role: 'customer',
      externalUserId: 'u',
    });
    const first = await store.insertMessage({
      conversationId: c.id,
      direction: 'in',
      author: 'customer',
      kind: 'text',
      text: 'a',
      clientMessageId: 'cm-1',
      status: 'accepted',
    });
    const again = await store.insertMessage({
      conversationId: c.id,
      direction: 'in',
      author: 'customer',
      kind: 'text',
      text: 'a',
      clientMessageId: 'cm-1',
      status: 'accepted',
    });
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, message: { id: first.message.id } });
    // Messages without a client id never conflict.
    await store.insertMessage({
      conversationId: c.id,
      direction: 'out',
      author: 'agent',
      kind: 'text',
      text: 'b',
      status: 'processed',
      cards: [
        {
          type: 'product',
          product_id: 'p',
          title: 't',
          price: { amount: 1, currency: 'XOF' },
          image_url: null,
          url: 'u',
        },
      ],
    });
    await store.insertMessage({
      conversationId: c.id,
      direction: 'out',
      author: 'agent',
      kind: 'text',
      text: 'c',
      status: 'processed',
    });
    const all = await store.listMessages(c.id, { limit: 10 });
    expect(all.map((m) => m.text)).toEqual(['a', 'b', 'c']);
    expect(all[1]?.cards[0]).toMatchObject({ type: 'product' });
    expect(
      (await store.listMessages(c.id, { after: first.message.id, limit: 10 })).map((m) => m.text),
    ).toEqual(['b', 'c']);
    expect((await store.recentMessages(c.id, 2)).map((m) => m.text)).toEqual(['b', 'c']);
    expect((await store.pendingInbound(c.id)).map((m) => m.id)).toEqual([first.message.id]);
    await store.setMessageStatus([first.message.id], 'processed');
    expect(await store.pendingInbound(c.id)).toEqual([]);
  });

  it('finds chat sessions by token hash', async () => {
    const store = make();
    const v = vendorId();
    const c = await store.upsertConversation({
      vendorId: v,
      channel: 'web',
      role: 'customer',
      externalUserId: 'u',
    });
    const token = `ct_${randomUUID()}`;
    const s = await store.createChatSession({
      vendorId: v,
      conversationId: c.id,
      tokenHash: sha256(token),
      ipHash: null,
      expiresAt: new Date(Date.now() + 1000),
    });
    expect((await store.findChatSessionByTokenHash(sha256(token)))?.id).toBe(s.id);
    expect(await store.findChatSessionByTokenHash(sha256('other'))).toBeNull();
    const later = new Date(Date.now() + 86_400_000);
    await store.touchChatSession(s.id, later);
    expect((await store.findChatSessionByTokenHash(sha256(token)))?.expiresAt.getTime()).toBe(
      later.getTime(),
    );
  });

  it('lists the inbox by last activity with unread counts and a cursor', async () => {
    const store = make();
    const v = vendorId();
    const ids: string[] = [];
    for (const u of ['u1', 'u2', 'u3']) {
      const c = await store.upsertConversation({
        vendorId: v,
        channel: 'web',
        role: 'customer',
        externalUserId: u,
      });
      ids.push(c.id);
      await store.insertMessage({
        conversationId: c.id,
        direction: 'in',
        author: 'customer',
        kind: 'text',
        text: u,
      });
    }
    await store.upsertConversation({
      vendorId: v,
      channel: 'web',
      role: 'vendor',
      externalUserId: v,
    });
    const page1 = await store.listInbox({ vendorId: v, limit: 2 });
    expect(page1.rows.map((r) => r.conversation.id)).toEqual([ids[2], ids[1]]);
    expect(page1.rows[0]?.unreadCount).toBe(1);
    expect(page1.rows[0]?.lastMessage?.text).toBe('u3');
    const page2 = await store.listInbox({
      vendorId: v,
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.rows.map((r) => r.conversation.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();
    await store.updateConversation(ids[2] as string, { vendorReadAt: new Date(Date.now() + 1000) });
    expect((await store.listInbox({ vendorId: v, limit: 1 })).rows[0]?.unreadCount).toBe(0);
  });

  it('merges state keys without erasing the others, and purges expired sessions', async () => {
    const store = make();
    const v = vendorId();
    const c = await store.upsertConversation({
      vendorId: v,
      channel: 'web',
      role: 'customer',
      externalUserId: 'u',
    });
    await store.patchState(
      c.id,
      { lastOrderNumber: 'A7K2', orders: { A7K2: 'https://x/c/1' } },
      [],
    );
    await store.patchState(c.id, { productInView: 'p' }, ['lastOrderNumber']);
    expect((await store.getConversation(c.id))?.state).toEqual({
      orders: { A7K2: 'https://x/c/1' },
      productInView: 'p',
    });

    const old = await store.createChatSession({
      vendorId: v,
      conversationId: c.id,
      tokenHash: sha256(`old-${v}`),
      ipHash: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.createChatSession({
      vendorId: v,
      conversationId: c.id,
      tokenHash: sha256(`new-${v}`),
      ipHash: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await store.purgeExpiredSessions(new Date())).toBeGreaterThanOrEqual(1);
    expect(await store.findChatSessionByTokenHash(sha256(`old-${v}`))).toBeNull();
    expect(await store.findChatSessionByTokenHash(sha256(`new-${v}`))).not.toBeNull();
    void old;
  });

  it('stores the vendor pause, with or without an end', async () => {
    const store = make();
    const v = vendorId();
    expect(await store.getVendorPause(v)).toBeNull();
    const until = new Date(Date.now() + 60_000);
    await store.setVendorPause(v, true, until);
    expect((await store.getVendorPause(v))?.until?.getTime()).toBe(until.getTime());
    await store.setVendorPause(v, true, null);
    expect(await store.getVendorPause(v)).toEqual({ until: null });
    await store.setVendorPause(v, false, null);
    expect(await store.getVendorPause(v)).toBeNull();
  });

  it('runs a function under the conversation lock and returns its result', async () => {
    const store = make();
    expect(await store.withConversationLock(randomUUID(), async () => 42)).toBe(42);
  });

  it('remembers processed core events', async () => {
    const store = make();
    const id = randomUUID();
    expect(await store.hasProcessedEvent(id)).toBe(false);
    expect(await store.markEventProcessed(id, 'order.paid')).toBe(true);
    expect(await store.markEventProcessed(id, 'order.paid')).toBe(false);
    expect(await store.hasProcessedEvent(id)).toBe(true);
  });
});
