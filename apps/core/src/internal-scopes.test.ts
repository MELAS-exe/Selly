// Every internal route has exactly the scope docs/api.json documents, and tokens get only what they were given.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { ROUTE_SCOPES } from './scopes';
import { createShop, createTestApp, SERVICE_TOKEN, type TestApp } from './testing';

const NARROW = 'ops-token-0123456789-abcdefghijklmnop';
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({
    SERVICE_TOKENS: JSON.stringify([{ name: 'ops', token: NARROW, scopes: ['orders:read'] }]),
  });
}, 60_000);
afterAll(() => t.close());

describe('service token scopes', () => {
  it('lists every internal route core serves, and only those', async () => {
    const app = buildApp(t.ctx);
    const internal: string[] = [];
    app.addHook('onRoute', (r) => {
      if (!r.url.startsWith('/internal/')) return;
      for (const m of [r.method].flat()) if (m !== 'HEAD') internal.push(`${m} ${r.url}`);
    });
    await app.ready();
    await app.close();
    expect(internal.sort()).toEqual(Object.keys(ROUTE_SCOPES).sort());
  });

  it('matches the scopes documented in docs/api.json', () => {
    const doc = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../docs/api.json', import.meta.url)), 'utf8'),
    ) as { paths: Record<string, Record<string, { description?: string }>> };
    const documented: Record<string, string> = {};
    for (const [path, ops] of Object.entries(doc.paths)) {
      // The agent's own routes (core calls them), not core's.
      if (
        !path.startsWith('/internal/') ||
        path === '/internal/v1/events' ||
        path.startsWith('/internal/v1/agent/')
      )
        continue;
      for (const [method, op] of Object.entries(ops)) {
        const scope = /Scope `([^`]+)`/.exec(op.description ?? '')?.[1];
        documented[`${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`] =
          scope ?? '(none)';
      }
    }
    expect(documented).toEqual(ROUTE_SCOPES);
  });

  it('lets a narrow token read orders and nothing else', async () => {
    const s = await createShop(t.db, 'scopes-a');
    const as = (token: string, method: 'GET' | 'POST', url: string, payload?: object) =>
      t.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      });

    expect((await as(NARROW, 'GET', `/internal/v1/vendors/${s.vendorId}/orders`)).statusCode).toBe(
      200,
    );
    const denied = await as(NARROW, 'POST', `/internal/v1/vendors/${s.vendorId}/usage`, {
      metric: 'agent_turns',
      quantity: 1,
      reference: 'scopes-test',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().detail).toContain('usage:write');
    expect(
      (await as(SERVICE_TOKEN, 'GET', `/internal/v1/vendors/${s.vendorId}/entitlements`))
        .statusCode,
    ).toBe(200);
    expect(
      (await as('wrong-token-wrong-token', 'GET', `/internal/v1/vendors/${s.vendorId}/orders`))
        .statusCode,
    ).toBe(401);
    expect(
      (await t.app.inject({ url: `/internal/v1/vendors/${s.vendorId}/orders` })).statusCode,
    ).toBe(401);
  });
});
