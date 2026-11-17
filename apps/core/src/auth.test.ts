import { core } from '@selly/db';
import { eq } from '@selly/db/orm';
import { FakeNwcWallet, TestRelay } from '@selly/nwc/testkit';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertContract } from './contract';
import { createTestApp, SERVICE_TOKEN, type TestApp } from './test-helpers';

let t: TestApp;
let relay: TestRelay;
const wallets: FakeNwcWallet[] = [];
beforeAll(async () => {
  t = await createTestApp();
  relay = await TestRelay.start();
}, 60_000);
afterAll(async () => {
  for (const w of wallets) w.close();
  await relay.stop();
  await t.close();
});

const ORIGIN = 'http://localhost:3000';
type Key = Uint8Array;
let ipSeq = 0;
/** Each call from its own address, so the sign-in rate limit only bites in the test made for it. */
const nextIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

/** Calls core with the app's Origin and an optional session cookie, and checks the answer against docs/api.json. */
async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  template: string,
  url: string,
  opts: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = `selly_session=${opts.cookie}`;
  const res = await t.app.inject({
    method,
    url,
    headers,
    remoteAddress: nextIp(),
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  const body = res.body ? res.json() : undefined;
  if (res.statusCode !== 204) assertContract(method, template, res.statusCode, body);
  return { status: res.statusCode, body, res };
}

const challenge = (purpose: 'sign_in' | 'step_up' | 'add_key', cookie?: string) =>
  call('POST', '/api/v1/auth/nostr/challenges', '/api/v1/auth/nostr/challenges', {
    body: { purpose },
    ...(cookie ? { cookie } : {}),
  });

const signTemplate = (
  template: { kind: number; created_at: number; tags: string[][]; content: string },
  sk: Key,
) => finalizeEvent(template, sk);

async function signIn(sk: Key, deviceLabel = 'Tecno Spark, Chrome') {
  const c = await challenge('sign_in');
  expect(c.status).toBe(201);
  const event = signTemplate(c.body.event_template, sk);
  const r = await call('POST', '/api/v1/auth/nostr/sessions', '/api/v1/auth/nostr/sessions', {
    body: { challenge_id: c.body.challenge_id, event, device_label: deviceLabel },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const cookie = r.res.cookies.find((k) => k.name === 'selly_session');
  return {
    body: r.body,
    cookie: cookie?.value as string,
    setCookie: cookie,
    event,
    challengeId: c.body.challenge_id as string,
  };
}

async function stepUp(cookie: string, sk: Key) {
  const c = await challenge('step_up', cookie);
  const event = signTemplate(c.body.event_template, sk);
  return call('POST', '/api/v1/auth/nostr/sessions', '/api/v1/auth/nostr/sessions', {
    body: { challenge_id: c.body.challenge_id, event },
    cookie,
  });
}

let shopCount = 0;
async function newShop() {
  const sk = generateSecretKey();
  const s = await signIn(sk);
  const slug = `shop-auth-${++shopCount}`;
  const v = await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
    body: { display_name: 'Ma Boutique', slug },
    cookie: s.cookie,
  });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  return { sk, cookie: s.cookie, vendorId: v.body.id as string, slug };
}

describe('sign-in', () => {
  it('signs in a new key with a signed challenge and sets a safe cookie', async () => {
    const sk = generateSecretKey();
    const c = await challenge('sign_in');
    expect(c.body.event_template).toMatchObject({
      kind: 27235,
      content: '',
      tags: [
        ['u', 'http://localhost:3000/api/v1/auth/nostr/sessions'],
        ['method', 'POST'],
        ['challenge', c.body.challenge],
      ],
    });
    expect(c.body.expires_at).toBe('2026-11-17T10:05:00Z');

    const s = await signIn(sk);
    expect(s.body).toMatchObject({
      session: { pubkey: getPublicKey(sk), step_up_expires_at: null },
      vendor: null,
    });
    expect(s.setCookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 2_592_000,
    });
    expect(s.cookie.length).toBeGreaterThanOrEqual(40);
    const [row] = await t.db
      .select()
      .from(core.vendorSessions)
      .where(eq(core.vendorSessions.id, s.body.session.id));
    expect(row?.tokenHash.toString('hex')).not.toContain(Buffer.from(s.cookie).toString('hex'));
  });

  it('P7: accepts a challenge once, even when the same event is sent several times at once', async () => {
    const sk = generateSecretKey();
    const c = await challenge('sign_in');
    const event = signTemplate(c.body.event_template, sk);
    const body = { challenge_id: c.body.challenge_id, event };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('POST', '/api/v1/auth/nostr/sessions', '/api/v1/auth/nostr/sessions', { body }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401, 401, 401]);
    const replay = await call(
      'POST',
      '/api/v1/auth/nostr/sessions',
      '/api/v1/auth/nostr/sessions',
      { body },
    );
    expect(replay.body).toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('P7: refuses an expired challenge, a tampered event and a wrong URL', async () => {
    const sk = generateSecretKey();
    const send = (challenge_id: string, event: unknown) =>
      call('POST', '/api/v1/auth/nostr/sessions', '/api/v1/auth/nostr/sessions', {
        body: { challenge_id, event },
      });

    const late = await challenge('sign_in');
    const lateEvent = signTemplate(late.body.event_template, sk);
    t.clock.advance(5 * 60_000 + 1000);
    expect((await send(late.body.challenge_id, lateEvent)).status).toBe(401);

    const c = await challenge('sign_in');
    const e = signTemplate(c.body.event_template, sk);
    expect(
      (await send(c.body.challenge_id, { ...e, pubkey: getPublicKey(generateSecretKey()) })).status,
    ).toBe(401);
    const otherUrl = signTemplate(
      {
        ...c.body.event_template,
        tags: [
          ['u', 'https://evil.example/api/v1/auth/nostr/sessions'],
          ['method', 'POST'],
          ['challenge', c.body.challenge],
        ],
      },
      sk,
    );
    expect((await send(c.body.challenge_id, otherUrl)).status).toBe(401);
    expect((await send('not-a-uuid', e)).status).toBe(401);
    // The failed attempts did not burn the challenge: the correct event still works.
    expect((await send(c.body.challenge_id, e)).status).toBe(200);
  });

  it('refuses requests without the app Origin', async () => {
    expect(
      (
        await call('POST', '/api/v1/auth/nostr/challenges', '/api/v1/auth/nostr/challenges', {
          body: { purpose: 'sign_in' },
          origin: null,
        })
      ).body,
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(
      (
        await call('POST', '/api/v1/auth/nostr/challenges', '/api/v1/auth/nostr/challenges', {
          body: { purpose: 'sign_in' },
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
  });

  it('needs a session for a step-up challenge', async () => {
    expect((await challenge('step_up')).body).toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('shop creation', () => {
  it('creates the shop for the key, which becomes its first key', async () => {
    const sk = generateSecretKey();
    const s = await signIn(sk);
    const v = await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
      body: { display_name: 'Awa Mode', slug: 'Awa-Mode', contact_whatsapp_e164: '+221770000000' },
      cookie: s.cookie,
    });
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({
      slug: 'awa-mode',
      store_url: 'http://localhost:3000/s/awa-mode',
      live: false,
      live_blockers: ['wallet_missing', 'subscription_required'],
      settings: { agent: { enabled: false } },
    });
    const me = await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', { cookie: s.cookie });
    expect(me.body.id).toBe(v.body.id);
    const keys = await call('GET', '/api/v1/vendors/me/keys', '/api/v1/vendors/me/keys', {
      cookie: s.cookie,
    });
    expect(keys.body.data).toEqual([
      expect.objectContaining({ pubkey: getPublicKey(sk), label: 'Première clé' }),
    ]);

    // Signing in again with that key finds the shop.
    expect((await signIn(sk)).body.vendor).toMatchObject({ id: v.body.id, slug: 'awa-mode' });
    // One shop per key.
    expect(
      (
        await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
          body: { display_name: 'Encore', slug: 'encore-une' },
          cookie: s.cookie,
        })
      ).status,
    ).toBe(422);
  });

  it('refuses a taken or reserved slug', async () => {
    const a = await newShop();
    const s = await signIn(generateSecretKey());
    expect(
      (
        await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
          body: { display_name: 'Copie', slug: a.slug },
          cookie: s.cookie,
        })
      ).body,
    ).toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(
      (
        await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
          body: { display_name: 'Admin', slug: 'admin' },
          cookie: s.cookie,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call('POST', '/api/v1/vendors', '/api/v1/vendors', {
          body: { display_name: 'X', slug: 'ok-slug' },
        })
      ).status,
    ).toBe(401);
  });

  it('updates settings one level deep and checks them', async () => {
    const shop = await newShop();
    const patch = (body: unknown) =>
      call('PATCH', '/api/v1/vendors/me', '/api/v1/vendors/me', { body, cookie: shop.cookie });
    await patch({ settings: { agent: { enabled: true, tone: 'formal' } } });
    const r = await patch({
      settings: {
        agent: { negotiation: { mode: 'allow', max_discount_pct: 8 } },
        delivery: {
          zones: [{ id: 'plateau', label: 'Plateau', fee: { amount: 1000, currency: 'XOF' } }],
        },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.settings.agent).toMatchObject({
      enabled: true,
      tone: 'formal',
      negotiation: { mode: 'allow', max_discount_pct: 8 },
    });
    expect(r.body.settings.delivery.zones).toHaveLength(1);

    expect(
      (
        await patch({
          settings: { agent: { negotiation: { mode: 'allow', max_discount_pct: 50 } } },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await patch({
          settings: {
            delivery: { zones: [{ id: 'z', label: 'Z', fee: { amount: 10, currency: 'SAT' } }] },
          },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await patch({
          settings: { alerts: { nostr_dm: { enabled: true, pubkey: getPublicKey(shop.sk) } } },
        })
      ).body,
    ).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN' });
    expect((await patch({ display_name: 'Nouveau nom', settings: { unknown: true } })).status).toBe(
      422,
    );
  });
});

describe('step-up and keys', () => {
  it('adds a key signed by the new key, after a step-up, up to three', async () => {
    const shop = await newShop();
    const addKey = async (sk: Key, label: string) => {
      const c = await challenge('add_key', shop.cookie);
      expect(c.body.event_template.tags[0]).toEqual([
        'u',
        'http://localhost:3000/api/v1/vendors/me/keys',
      ]);
      return call('POST', '/api/v1/vendors/me/keys', '/api/v1/vendors/me/keys', {
        body: {
          challenge_id: c.body.challenge_id,
          event: signTemplate(c.body.event_template, sk),
          label,
        },
        cookie: shop.cookie,
      });
    };

    const spare = generateSecretKey();
    expect((await addKey(spare, 'Clé de secours')).body).toMatchObject({
      code: 'STEP_UP_REQUIRED',
      status: 403,
    });

    const up = await stepUp(shop.cookie, shop.sk);
    expect(up.status).toBe(200);
    const in10 = new Date(t.ctx.now().getTime() + 600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(up.body.session.step_up_expires_at).toBe(in10);

    const added = await addKey(spare, 'Clé de secours');
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ pubkey: getPublicKey(spare), label: 'Clé de secours' });
    expect((await addKey(spare, 'Encore')).status).toBe(422); // already one of the keys
    expect((await addKey(generateSecretKey(), 'Troisième')).status).toBe(201);
    expect((await addKey(generateSecretKey(), 'Quatrième')).body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ limit: 'keys', max: 3 }],
    });

    // The spare key signs in to the same shop.
    expect((await signIn(spare)).body.vendor.id).toBe(shop.vendorId);
  });

  it('refuses a step-up signed by a stranger, and a key of another shop', async () => {
    const shop = await newShop();
    const other = await newShop();
    expect((await stepUp(shop.cookie, generateSecretKey())).body).toMatchObject({
      code: 'CHALLENGE_INVALID',
    });
    expect((await stepUp(shop.cookie, other.sk)).status).toBe(401);

    await stepUp(shop.cookie, shop.sk);
    const c = await challenge('add_key', shop.cookie);
    const taken = await call('POST', '/api/v1/vendors/me/keys', '/api/v1/vendors/me/keys', {
      body: {
        challenge_id: c.body.challenge_id,
        event: signTemplate(c.body.event_template, other.sk),
      },
      cookie: shop.cookie,
    });
    expect(taken.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'This key belongs to another shop.',
    });
  });

  it('removes a key and its sessions, never the last one, and the step-up expires', async () => {
    const shop = await newShop();
    await stepUp(shop.cookie, shop.sk);
    const spare = generateSecretKey();
    const c = await challenge('add_key', shop.cookie);
    await call('POST', '/api/v1/vendors/me/keys', '/api/v1/vendors/me/keys', {
      body: {
        challenge_id: c.body.challenge_id,
        event: signTemplate(c.body.event_template, spare),
      },
      cookie: shop.cookie,
    });
    const spareSession = await signIn(spare);

    const del = (pubkey: string) =>
      call('DELETE', '/api/v1/vendors/me/keys/{pubkey}', `/api/v1/vendors/me/keys/${pubkey}`, {
        cookie: shop.cookie,
      });
    expect((await del(getPublicKey(spare))).status).toBe(204);
    expect(
      (
        await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', {
          cookie: spareSession.cookie,
        })
      ).status,
    ).toBe(401);
    expect((await del(getPublicKey(shop.sk))).body).toMatchObject({
      code: 'VALIDATION_FAILED',
      detail: 'The last key cannot be removed. Add another key first.',
    });

    t.clock.advance(10 * 60_000 + 1000);
    expect((await del(getPublicKey(shop.sk))).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});

describe('sessions', () => {
  it('lists devices, signs one out, and logs out', async () => {
    const shop = await newShop();
    const phone = await signIn(shop.sk, 'Téléphone');
    const list = await call('GET', '/api/v1/auth/sessions', '/api/v1/auth/sessions', {
      cookie: shop.cookie,
    });
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const del = await call(
      'DELETE',
      '/api/v1/auth/sessions/{id}',
      `/api/v1/auth/sessions/${phone.body.session.id}`,
      { cookie: shop.cookie },
    );
    expect(del.status).toBe(204);
    expect(
      (await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', { cookie: phone.cookie }))
        .status,
    ).toBe(401);
    // Another shop cannot sign this one's devices out.
    const other = await newShop();
    expect(
      (
        await call(
          'DELETE',
          '/api/v1/auth/sessions/{id}',
          `/api/v1/auth/sessions/${list.body.data[0].id}`,
          { cookie: other.cookie },
        )
      ).status,
    ).toBe(404);

    const out = await call('POST', '/api/v1/auth/logout', '/api/v1/auth/logout', {
      cookie: shop.cookie,
      // Many clients always send this header, also without a body: an empty JSON body is accepted.
      headers: { 'content-type': 'application/json' },
    });
    expect(out.status).toBe(204);
    expect(out.res.cookies.find((k) => k.name === 'selly_session')?.value).toBe('');
    expect(
      (await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', { cookie: shop.cookie }))
        .status,
    ).toBe(401);
  });

  it('expires after 30 days without use', async () => {
    const shop = await newShop();
    t.clock.advance(31 * 86_400_000);
    expect(
      (await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', { cookie: shop.cookie }))
        .status,
    ).toBe(401);
  });

  it('answers the agent introspection, with the service token only', async () => {
    const shop = await newShop();
    const introspect = (session_cookie: string, token = SERVICE_TOKEN) =>
      call('POST', '/internal/v1/sessions/introspect', '/internal/v1/sessions/introspect', {
        body: { session_cookie },
        headers: { authorization: `Bearer ${token}` },
        origin: null,
      });
    expect((await introspect(shop.cookie)).body).toEqual({
      valid: true,
      vendor_id: shop.vendorId,
      pubkey: getPublicKey(shop.sk),
      step_up_expires_at: null,
    });
    expect((await introspect('nope')).body).toEqual({
      valid: false,
      vendor_id: null,
      pubkey: null,
      step_up_expires_at: null,
    });
    expect((await introspect(shop.cookie, 'wrong-token-value')).status).toBe(401);
  });

  it('rate-limits sign-in per IP', async () => {
    let last = 0;
    let body: { code?: string } = {};
    for (let i = 0; i < 25 && last !== 429; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/nostr/challenges',
        payload: { purpose: 'sign_in' },
        headers: { origin: ORIGIN },
        remoteAddress: '10.9.9.9',
      });
      last = r.statusCode;
      body = r.json();
      if (last === 429) {
        expect(r.headers['retry-after']).toBeDefined();
        assertContract('POST', '/api/v1/auth/nostr/challenges', 429, body);
      }
    }
    expect(last).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
  });
});

describe('wallet over HTTP', () => {
  it('links, shows and replaces a wallet; replacing and unlinking need a step-up', async () => {
    const shop = await newShop();
    const w1 = await FakeNwcWallet.start({ relayUrl: relay.url });
    const w2 = await FakeNwcWallet.start({ relayUrl: relay.url });
    wallets.push(w1, w2);
    const put = (uri: string) =>
      call('PUT', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
        body: { kind: 'nwc', uri },
        cookie: shop.cookie,
      });

    const linked = await put(w1.uri);
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(JSON.stringify(linked.body)).not.toContain(w1.clientSecret);
    const shown = await call('GET', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
      cookie: shop.cookie,
    });
    expect(shown.body).toMatchObject({ kind: 'nwc', status: 'active', receive_only: true });
    expect(
      (await call('GET', '/api/v1/vendors/me', '/api/v1/vendors/me', { cookie: shop.cookie })).body
        .live_blockers,
    ).toEqual(['subscription_required']);

    expect((await put(w2.uri)).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await stepUp(shop.cookie, shop.sk);
    expect((await put(w2.uri)).status).toBe(200);
    expect(
      (
        await call('PUT', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
          body: { kind: 'lightning_address', lud16: 'a@b.c' },
          cookie: shop.cookie,
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await call('DELETE', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
          cookie: shop.cookie,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call('GET', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
          cookie: shop.cookie,
        })
      ).status,
    ).toBe(404);
    t.clock.advance(11 * 60_000);
    expect(
      (
        await call('DELETE', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
          cookie: shop.cookie,
        })
      ).body,
    ).toMatchObject({ code: 'STEP_UP_REQUIRED' });
  }, 30_000);
});

describe('wallet pairing over HTTP', () => {
  it('returns a nostr+walletauth link, and needs a step-up when a wallet is already linked', async () => {
    const shop = await newShop();
    const post = () =>
      call('POST', '/api/v1/vendors/me/wallet/pairing', '/api/v1/vendors/me/wallet/pairing', {
        body: {},
        cookie: shop.cookie,
      });
    const first = await post();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.open_uri).toMatch(/^nostr\+walletauth:\/\/[0-9a-f]{64}\?/);

    const w = await FakeNwcWallet.start({ relayUrl: relay.url });
    wallets.push(w);
    await call('PUT', '/api/v1/vendors/me/wallet', '/api/v1/vendors/me/wallet', {
      body: { kind: 'nwc', uri: w.uri },
      cookie: shop.cookie,
    });
    t.clock.advance(11 * 60_000);
    expect((await post()).body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await stepUp(shop.cookie, shop.sk);
    expect((await post()).status).toBe(201);
  }, 30_000);
});
