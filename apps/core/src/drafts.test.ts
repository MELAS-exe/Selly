// Photos and product drafts (architecture.md sections 5.3.6, 6.5 and 8.6): presigned uploads, re-encoded images,
// drafts from the dashboard and from the assistant, confirm as a new product or as a restock.
import { core } from '@selly/db';
import { and, eq } from '@selly/db/orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failStaleDrafts } from './modules/inventory/drafts';
import {
  assertContract,
  createShop,
  createTestApp,
  createVendorSession,
  idemKey,
  SERVICE_TOKEN,
  type TestApp,
} from './testing';

let t: TestApp;
let jpeg: Buffer;
beforeAll(async () => {
  t = await createTestApp();
  // 1200 × 800, stored on its side with EXIF orientation 6 and a GPS-looking comment: both must be gone.
  jpeg = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: { r: 200, g: 30, b: 40 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { ImageDescription: 'GPS 14.69N 17.44W' } } })
    .toBuffer();
}, 60_000);
afterAll(() => t.close());

const ORIGIN = 'http://localhost:3000';
const AUTH = { authorization: `Bearer ${SERVICE_TOKEN}` };
let seq = 0;

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  template: string,
  url: string,
  opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: {
      ...(opts.cookie ? { origin: ORIGIN, cookie: `selly_session=${opts.cookie}` } : AUTH),
      ...(opts.headers ?? {}),
    },
    remoteAddress: `10.7.${Math.floor(++seq / 250)}.${seq % 250}`,
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  const json = res.body ? res.json() : undefined;
  if (res.statusCode !== 204) assertContract(method, template, res.statusCode, json);
  return { status: res.statusCode, body: json };
}

async function shop(slug: string, plan: 'starter' | 'pro' = 'pro') {
  const s = await createShop(t.db, slug, { plan });
  const { cookie } = await createVendorSession(t, s.vendorId);
  return { ...s, cookie };
}

/** What the browser does: ask for a presigned URL, then PUT the bytes (here, straight into the memory store). */
async function upload(cookie: string, bytes = jpeg, type = 'image/jpeg') {
  const res = await call('POST', '/api/v1/media/uploads', '/api/v1/media/uploads', {
    cookie,
    body: { content_type: type, size_bytes: bytes.length },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await t.media.put('private', res.body.storage_key, bytes, type);
  return res.body.storage_key as string;
}

/** The agent's extraction, in the format of apps/agent/src/vision (toDraftExtracted). */
const extraction = (title: string, variants: { size: string; stock: number | null }[]) => ({
  title: { value: title, confidence: 0.9, from: 'text' },
  description: { value: 'Baskets en toile', confidence: 0.7, from: 'image' },
  category: { value: 'chaussures', confidence: 0.8, from: 'inferred' },
  price: { value: { amount: 20000, currency: 'XOF' }, confidence: 0.95, from: 'text' },
  variants: {
    value: variants.map((v) => ({ options: { size: v.size }, stock: v.stock })),
    confidence: 0.6,
    from: 'text',
  },
});

describe('uploads and images', () => {
  it('hands out a presigned upload for JPEG, PNG or WebP up to 8 MB', async () => {
    const s = await shop('media-a');
    const key = await upload(s.cookie);
    expect(key).toMatch(new RegExp(`^vendors/${s.vendorId}/uploads/[0-9a-f-]{36}\\.jpg$`));
    expect(t.media.signed.at(-1)).toMatchObject({ key, sizeBytes: jpeg.length });

    const heic = await call('POST', '/api/v1/media/uploads', '/api/v1/media/uploads', {
      cookie: s.cookie,
      body: { content_type: 'image/heic', size_bytes: 1000 },
    });
    expect(heic.status).toBe(422);
    const big = await call('POST', '/api/v1/media/uploads', '/api/v1/media/uploads', {
      cookie: s.cookie,
      body: { content_type: 'image/jpeg', size_bytes: 9 * 1024 * 1024 },
    });
    expect(big.status).toBe(422);
  });

  it('re-encodes a product photo: upright, three widths in WebP and AVIF, no metadata', async () => {
    const s = await shop('media-b');
    const key = await upload(s.cookie);
    const res = await call('POST', '/api/v1/inventory', '/api/v1/inventory', {
      cookie: s.cookie,
      headers: { 'idempotency-key': idemKey() },
      body: {
        title: 'Pagne tissé',
        price: { amount: 9000, currency: 'XOF' },
        image_keys: [key],
        variants: [{ options: {}, on_hand: 2 }],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [img] = res.body.images;
    // Stored 800 × 1200 with orientation 6: upright it is 1200 wide, so 640 × 427.
    expect(img).toMatchObject({ width: 640, height: 427 });
    expect(img.url).toMatch(
      new RegExp(
        `^http://localhost:9000/selly-public/vendors/${s.vendorId}/images/[0-9a-f-]{36}/640\\.webp$`,
      ),
    );
    expect(img.dominant).toMatch(/^#[0-9a-f]{6}$/);

    const prefix = img.url
      .replace('http://localhost:9000/selly-public/', '')
      .replace('/640.webp', '');
    for (const w of [320, 640, 960])
      for (const ext of ['webp', 'avif'])
        expect(await t.media.head('public', `${prefix}/${w}.${ext}`), `${w}.${ext}`).not.toBeNull();
    const out = await t.media.get('public', `${prefix}/960.webp`);
    const meta = await sharp(out?.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(960);
  });

  it('refuses an upload of another shop, a missing file and a file that is not an image', async () => {
    const a = await shop('media-c');
    const b = await shop('media-d');
    const theirs = await upload(b.cookie);
    const notImage = await upload(a.cookie, Buffer.from('not an image at all'));
    const missing = `vendors/${a.vendorId}/uploads/0193a000-0000-7000-8000-000000000001.jpg`;
    for (const key of [theirs, notImage, missing]) {
      const res = await call('POST', '/api/v1/inventory', '/api/v1/inventory', {
        cookie: a.cookie,
        headers: { 'idempotency-key': idemKey() },
        body: {
          title: 'Sac',
          price: { amount: 5000, currency: 'XOF' },
          image_keys: [key],
          variants: [{ options: {}, on_hand: 1 }],
        },
      });
      expect(res.status, key).toBe(422);
    }
  });

  it('replaces, reorders and removes the images of a product', async () => {
    const s = await shop('media-e');
    const first = await upload(s.cookie);
    const created = await call('POST', '/api/v1/inventory', '/api/v1/inventory', {
      cookie: s.cookie,
      headers: { 'idempotency-key': idemKey() },
      body: {
        title: 'Boubou',
        price: { amount: 25000, currency: 'XOF' },
        image_keys: [first],
        variants: [{ options: {}, on_hand: 1 }],
      },
    });
    const id = created.body.id;
    const [row] = await t.db
      .select()
      .from(core.productImages)
      .where(eq(core.productImages.productId, id));
    const second = await upload(s.cookie);
    const patched = await call(
      'PATCH',
      '/api/v1/inventory/{product_id}',
      `/api/v1/inventory/${id}`,
      {
        cookie: s.cookie,
        body: { image_keys: [second, row?.storageKey] },
      },
    );
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.images).toHaveLength(2);
    expect(patched.body.images[1].url).toContain(row?.storageKey);

    const cleared = await call(
      'PATCH',
      '/api/v1/inventory/{product_id}',
      `/api/v1/inventory/${id}`,
      {
        cookie: s.cookie,
        body: { image_keys: [] },
      },
    );
    expect(cleared.body.images).toEqual([]);
  });

  it('takes files from the agent: voice notes, and photos for a vendor', async () => {
    const s = await shop('media-f');
    const post = async (form: FormData, headers: Record<string, string> = {}) => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/internal/v1/media',
        headers: { ...AUTH, ...headers },
        payload: form,
      });
      const json = res.json();
      assertContract('POST', '/internal/v1/media', res.statusCode, json);
      return { status: res.statusCode, body: json };
    };
    const audio = new FormData();
    audio.set('file', new Blob([Buffer.alloc(1000, 1)], { type: 'audio/webm' }), 'note.webm');
    const voice = await post(audio, { 'x-actor': 'customer:abc' });
    expect(voice.status).toBe(201);
    expect(voice.body).toMatchObject({ content_type: 'audio/webm', size_bytes: 1000 });
    expect(voice.body.storage_key).toMatch(/^chat-audio\/\d{4}-\d{2}\/[0-9a-f-]{36}\.webm$/);
    expect(await t.media.head('private', voice.body.storage_key)).not.toBeNull();

    const tooLong = new FormData();
    tooLong.set('file', new Blob([Buffer.alloc(3 * 1024 * 1024)], { type: 'audio/ogg' }), 'n.ogg');
    expect((await post(tooLong)).status).toBe(422);

    const photo = () => {
      const f = new FormData();
      f.set('file', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'p.jpg');
      return f;
    };
    const ok = await post(photo(), { 'x-actor': `vendor:${s.vendorId}` });
    expect(ok.status).toBe(201);
    expect(ok.body.storage_key).toMatch(new RegExp(`^vendors/${s.vendorId}/uploads/`));
    expect((await post(photo())).status).toBe(422);
  });
});

describe('read links for the agent', () => {
  it('signs links to the vendor’s own uploads only', async () => {
    const s = await shop('links-a');
    const other = await shop('links-b');
    const key = await upload(s.cookie);
    const url = `/internal/v1/vendors/${s.vendorId}/media/links`;
    const ok = await call('POST', '/internal/v1/vendors/{id}/media/links', url, {
      body: { keys: [key] },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.links).toEqual([
      { key, url: expect.stringContaining(key), expires_at: expect.any(String) },
    ]);
    const theirs = await upload(other.cookie);
    const missing = `vendors/${s.vendorId}/uploads/0193a000-0000-7000-8000-000000000009.jpg`;
    for (const k of [theirs, missing, 'chat-audio/2026-11/x.webm'])
      expect(
        (await call('POST', '/internal/v1/vendors/{id}/media/links', url, { body: { keys: [k] } }))
          .status,
        k,
      ).toBe(422);
  });
});
describe('drafts', () => {
  it('dashboard: processing, extracted by the agent, answered, confirmed as a new product', async () => {
    const s = await shop('draft-a');
    const key = await upload(s.cookie);
    const restockKey = idemKey();
    const created = await call(
      'POST',
      '/api/v1/inventory/restock-ai',
      '/api/v1/inventory/restock-ai',
      {
        cookie: s.cookie,
        headers: { 'idempotency-key': restockKey },
        body: { image_keys: [key], text: 'Ajoute ces baskets à 20 000, 5 paires du 40 au 44' },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(202);
    expect(created.body).toMatchObject({
      status: 'processing',
      source: 'dashboard',
      image_keys: [key],
    });
    const draftId = created.body.id as string;

    // The agent is asked, with links its vision model can read.
    const [event] = await t.db.select().from(core.outbox).where(eq(core.outbox.key, draftId));
    expect(event?.topic).toBe('draft.requested');
    expect((event?.payload.data as { image_urls: string[] }).image_urls).toHaveLength(1);
    const usage = await t.db
      .select()
      .from(core.usageCounters)
      .where(
        and(eq(core.usageCounters.vendorId, s.vendorId), eq(core.usageCounters.metric, 'drafts')),
      );
    expect(usage[0]?.used).toBe(1);

    // The agent sends the extraction back. Its own usage report has the same reference: still one draft.
    const sizes = ['40', '41', '42', '43', '44'].map((size) => ({ size, stock: null }));
    const upserted = await call(
      'POST',
      '/internal/v1/vendors/{id}/product-drafts',
      `/internal/v1/vendors/${s.vendorId}/product-drafts`,
      {
        body: {
          draft_id: draftId,
          image_keys: [key],
          extracted: extraction('Baskets blanches', sizes),
          questions: [
            {
              id: 'stock_split',
              text: '5 au total ou 5 par pointure ?',
              choices: ['5 au total', '5 par pointure'],
            },
          ],
        },
      },
    );
    expect(upserted.status, JSON.stringify(upserted.body)).toBe(201);
    expect(upserted.body.status).toBe('needs_review');
    await call(
      'POST',
      '/internal/v1/vendors/{id}/usage',
      `/internal/v1/vendors/${s.vendorId}/usage`,
      {
        body: { metric: 'drafts', quantity: 1, reference: draftId },
      },
    );
    const [after] = await t.db
      .select()
      .from(core.usageCounters)
      .where(
        and(eq(core.usageCounters.vendorId, s.vendorId), eq(core.usageCounters.metric, 'drafts')),
      );
    expect(after?.used).toBe(1);
    const [ready] = await t.db
      .select()
      .from(core.vendorNotifications)
      .where(
        and(
          eq(core.vendorNotifications.vendorId, s.vendorId),
          eq(core.vendorNotifications.type, 'draft.ready'),
        ),
      );
    expect(ready?.data).toMatchObject({ draft_id: draftId, status: 'needs_review' });

    const confirmUrl = `/api/v1/inventory/drafts/${draftId}/confirm`;
    const template = '/api/v1/inventory/drafts/{id}/confirm';
    const open = await call('POST', template, confirmUrl, {
      cookie: s.cookie,
      body: { mode: 'new' },
    });
    expect(open.status).toBe(422);
    expect(open.body.errors).toEqual([
      { question_id: 'stock_split', message: '5 au total ou 5 par pointure ?' },
    ]);

    const done = await call('POST', template, confirmUrl, {
      cookie: s.cookie,
      body: { mode: 'new', answers: { stock_split: '5 par pointure' } },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({ title: 'Baskets blanches', price: { amount: 20000 } });
    expect(done.body.variants.map((v: { on_hand: number }) => v.on_hand)).toEqual([5, 5, 5, 5, 5]);
    expect(done.body.images).toHaveLength(1);

    const draft = await call(
      'GET',
      '/api/v1/inventory/drafts/{id}',
      `/api/v1/inventory/drafts/${draftId}`,
      {
        cookie: s.cookie,
      },
    );
    expect(draft.body.status).toBe('confirmed');
    expect(
      (
        await call('POST', template, confirmUrl, {
          cookie: s.cookie,
          body: { mode: 'new', answers: { stock_split: '5 par pointure' } },
        })
      ).status,
    ).toBe(404);
    const movements = await t.db
      .select()
      .from(core.inventoryMovements)
      .where(eq(core.inventoryMovements.draftId, draftId));
    expect(movements).toHaveLength(5);
  });

  it('assistant: a draft that matches an existing product, confirmed as a restock', async () => {
    const s = await shop('draft-b');
    const key = await upload(s.cookie);
    const created = await call(
      'POST',
      '/internal/v1/vendors/{id}/product-drafts',
      `/internal/v1/vendors/${s.vendorId}/product-drafts`,
      {
        headers: { 'x-actor': `vendor:${s.vendorId}` },
        body: {
          draft_id: null,
          image_keys: [key],
          input_text: '+2 robes wax en 42 et 1 en 44',
          extracted: extraction('Robe wax noire', [
            { size: '42', stock: 2 },
            { size: '44', stock: 1 },
          ]),
          questions: [],
        },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: 'needs_review', source: 'assistant' });
    expect(created.body.matches[0]).toMatchObject({
      product_id: s.productId,
      title: 'Robe wax noire',
    });

    // The existing variant is size 42 colour noir; the draft says size 42 only, so it is a new variant there.
    const res = await call(
      'POST',
      '/internal/v1/product-drafts/{id}/confirm',
      `/internal/v1/product-drafts/${created.body.id}/confirm`,
      {
        body: {
          mode: 'restock',
          target_product_id: s.productId,
          edits: {
            variants: [
              { options: { size: '42', color: 'noir' }, stock: 2 },
              { options: { size: '44', color: 'noir' }, stock: 1 },
            ],
          },
        },
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const bySize = Object.fromEntries(
      res.body.variants.map((v: { options: { size: string }; on_hand: number }) => [
        v.options.size,
        v.on_hand,
      ]),
    );
    expect(bySize).toEqual({ '42': 5, '44': 1 });
  });

  it('counts drafts against the plan and refuses one past the limit', async () => {
    const s = await shop('draft-c', 'starter');
    const key = await upload(s.cookie);
    const month = `${t.clock.now().toISOString().slice(0, 7)}-01`;
    await t.db
      .insert(core.usageCounters)
      .values({ vendorId: s.vendorId, metric: 'drafts', month, used: 10 });
    const res = await call('POST', '/api/v1/inventory/restock-ai', '/api/v1/inventory/restock-ai', {
      cookie: s.cookie,
      headers: { 'idempotency-key': idemKey() },
      body: { image_keys: [key] },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('lists open drafts, discards one, and fails a draft the agent never answered', async () => {
    const s = await shop('draft-d');
    const key = await upload(s.cookie);
    const make = async () =>
      (
        await call('POST', '/api/v1/inventory/restock-ai', '/api/v1/inventory/restock-ai', {
          cookie: s.cookie,
          headers: { 'idempotency-key': idemKey() },
          body: { image_keys: [key] },
        })
      ).body.id as string;
    const a = await make();
    const b = await make();
    const list = await call('GET', '/api/v1/inventory/drafts', '/api/v1/inventory/drafts', {
      cookie: s.cookie,
    });
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([b, a]);

    const discarded = await t.app.inject({
      method: 'POST',
      url: `/api/v1/inventory/drafts/${a}/discard`,
      headers: { origin: ORIGIN, cookie: `selly_session=${s.cookie}` },
    });
    expect(discarded.statusCode).toBe(204);

    t.clock.advance(11 * 60_000);
    expect(await failStaleDrafts(t.ctx)).toBeGreaterThanOrEqual(1);
    const failed = await call(
      'GET',
      '/api/v1/inventory/drafts',
      '/api/v1/inventory/drafts?status=failed',
      {
        cookie: s.cookie,
      },
    );
    expect(failed.body.data.map((d: { id: string }) => d.id)).toEqual([b]);
    const left = await call('GET', '/api/v1/inventory/drafts', '/api/v1/inventory/drafts', {
      cookie: s.cookie,
    });
    expect(left.body.data).toEqual([]);
  });
});
