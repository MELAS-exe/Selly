// Service tokens and their scopes for /internal/* (architecture.md sections 5.2 group G and 11.1).
// Every internal route needs one scope, listed here. A route that is not listed is refused for every token, so a new
// route cannot be reached until someone decides who may call it. internal-scopes.test.ts checks this table against
// the routes core serves and the scopes docs/api.json documents.
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const SCOPES = [
  'vendors:read',
  'entitlements:read',
  'usage:write',
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'drafts:write',
  'inventory:write',
  'media:read',
  'media:write',
  'notifications:write',
  'auth:introspect',
] as const;
export type Scope = (typeof SCOPES)[number];

/** `METHOD /path` with Fastify's `:param` names, as in req.routeOptions.url. */
export const ROUTE_SCOPES: Record<string, Scope> = {
  'GET /internal/v1/stores/:slug/vendor': 'vendors:read',
  'GET /internal/v1/vendors/:id/agent-profile': 'vendors:read',
  'GET /internal/v1/vendors/:id/entitlements': 'entitlements:read',
  'POST /internal/v1/vendors/:id/usage': 'usage:write',
  'GET /internal/v1/vendors/:id/products/search': 'catalog:read',
  'GET /internal/v1/vendors/:id/products/:product_id': 'catalog:read',
  'PATCH /internal/v1/vendors/:id/products/:product_id': 'catalog:write',
  'POST /internal/v1/vendors/:id/cart-quotes': 'orders:write',
  'POST /internal/v1/vendors/:id/orders': 'orders:write',
  'GET /internal/v1/vendors/:id/orders': 'orders:read',
  'GET /internal/v1/vendors/:id/orders/:order_ref': 'orders:read',
  'POST /internal/v1/vendors/:id/orders/:order_ref/fulfill': 'orders:write',
  'GET /internal/v1/vendors/:id/metrics': 'orders:read',
  'POST /internal/v1/vendors/:id/product-drafts': 'drafts:write',
  'POST /internal/v1/vendors/:id/product-drafts/:draft_id/confirm': 'drafts:write',
  'POST /internal/v1/vendors/:id/variants/:variant_id/adjustments': 'inventory:write',
  'POST /internal/v1/media': 'media:write',
  'POST /internal/v1/vendors/:id/media/links': 'media:read',
  'POST /internal/v1/vendors/:id/notifications': 'notifications:write',
  'POST /internal/v1/sessions/introspect': 'auth:introspect',
};

export interface ServiceToken {
  name: string;
  token: string;
  scopes: ReadonlySet<Scope>;
}

const extraTokens = z.array(
  z.strictObject({
    name: z.string().min(1).max(40),
    token: z.string().min(8),
    scopes: z.array(z.enum(SCOPES)).min(1),
  }),
);

/**
 * The agent's token (SERVICE_TOKEN_AGENT) has every scope above: the agent uses them all. SERVICE_TOKENS adds
 * narrower ones, as JSON: [{"name": "ops", "token": "...", "scopes": ["orders:read"]}].
 */
export function serviceTokens(config: { SERVICE_TOKEN_AGENT: string; SERVICE_TOKENS: string }) {
  const tokens: ServiceToken[] = [
    { name: 'agent', token: config.SERVICE_TOKEN_AGENT, scopes: new Set(SCOPES) },
  ];
  if (config.SERVICE_TOKENS.trim()) {
    for (const t of extraTokens.parse(JSON.parse(config.SERVICE_TOKENS)))
      tokens.push({ name: t.name, token: t.token, scopes: new Set(t.scopes) });
  }
  return tokens;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The token that matches, compared in constant time against every configured token. */
export function findToken(tokens: ServiceToken[], presented: string): ServiceToken | null {
  let found: ServiceToken | null = null;
  for (const t of tokens) if (safeEqual(t.token, presented)) found = t;
  return found;
}
