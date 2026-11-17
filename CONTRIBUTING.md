# Contributing to Selly

Read [docs/architecture.md](docs/architecture.md) first, then the contract in [docs/api.json](docs/api.json).

## Setup

Requirements: Node 24 (see `.nvmrc`), pnpm 10, Docker (for PostgreSQL, MinIO and a local Nostr relay).

```
pnpm install
cp .env.example .env
pnpm infra:up
pnpm dev
```

| App             | Port | Folder     |
| --------------- | ---- | ---------- |
| web (Next.js)   | 3000 | apps/web   |
| core (Fastify)  | 4000 | apps/core  |
| agent (Fastify) | 4100 | apps/agent |

The web app proxies `/api/v1/chat/*`, `/api/v1/conversations*` and `/api/v1/assistant*` to the agent, and every other `/api/v1/*` path to core. This mirrors production routing (architecture.md section 11.1).

## Run everything in Docker

```
docker compose up --build
```

This starts PostgreSQL 18, MinIO (the buckets are created for you), a local Nostr relay, and the three apps built from `apps/*/Dockerfile`. Then open http://localhost:3000. Core is on :4000 and agent on :4100. Secrets default to dev values; override them in a root `.env`. Stop with `docker compose down` (add `-v` to wipe the data).

For day-to-day work, `pnpm infra:up` starts only the infrastructure, and `pnpm dev` runs the apps with hot reload.

## What core already does

Core applies the migrations and loads a demo shop at start (`MIGRATE_ON_START` and `SEED_DEMO`, on by default locally). The demo shop is `awa-style`, with three products and two delivery zones.

These endpoints work, and their responses match `docs/api.json`:

- Storefront: `GET /api/v1/stores/{slug}`, `/products`, `/products/{product_id}`, `POST /cart-quotes`.
- Checkout: `POST /api/v1/orders`, `GET /api/v1/checkout/{token}`, `/status`, `/events` (SSE), `POST /invoice`.
- `GET /api/v1/rates/btc-xof` and `GET /api/v1/plans`.
- Vendor sign-in with a Nostr key (cookie `selly_session`): `POST /api/v1/auth/nostr/challenges` and `/sessions`,
  `/auth/logout`, `/auth/sessions`, `/vendors/me/keys`, step-up. Then `POST /api/v1/vendors`, `GET` and `PATCH /vendors/me`,
  and the wallet: `PUT`, `GET` and `DELETE /vendors/me/wallet`. State-changing requests need `Origin: <APP_BASE_URL>`.
- For the agent's inbox and assistant: `POST /internal/v1/sessions/introspect`.
- The dashboard: products (`GET`, `POST /api/v1/inventory`, `PATCH /inventory/{product_id}`), stock
  (`POST /inventory/variants/{variant_id}/adjustments`), orders (`GET /api/v1/orders`, `/orders/{id}`,
  `PATCH /orders/{id}/fulfill`, `POST /orders/{id}/cancel`), `GET /vendors/dashboard/metrics`,
  `POST /vendors/me/push-subscriptions`, and the live stream `GET /vendors/me/events` (SSE).
- `POST /internal/v1/vendors/{id}/notifications`: the agent alerts the vendor (shown on the live stream).
- For the agent (service token), every route of group G except drafts, media, notifications and session introspection:
  `GET /internal/v1/stores/{slug}/vendor`, and under `/internal/v1/vendors/{id}/`: `agent-profile`, `entitlements`, `usage`,
  `products/search`, `products/{product_id}` (GET and PATCH), `variants/{variant_id}/adjustments`, `cart-quotes`,
  `orders` (GET and POST), `orders/{order_ref}`, `orders/{order_ref}/fulfill`, `metrics`. Core tests check every
  answer against `docs/api.json`.
- Events: core delivers `order.*` and `wallet.*` events to the agent's `POST /internal/v1/events`, signed with
  `EVENTS_HMAC_SECRET`, in order per order, with retries.

A shop is open only with a plan that is trialing, active or in grace. The demo shop has a year of Pro.

By default Lightning is simulated (`INVOICE_PROVIDER=fake`): invoices look real but cannot be paid. Not built yet: photos and drafts, sending Web Push, and paying for a subscription (a new shop has no plan, so it cannot add products yet); mock them from `docs/api.json`.

## Taking real payments on a wallet (NWC)

1. In a wallet that supports Nostr Wallet Connect, create a connection that can **only receive**: `make_invoice`, `lookup_invoice`, `get_info`, and `get_balance` if you want the balance shown. Selly refuses a connection that can pay. Copy its `nostr+walletconnect://` link.
2. In `.env`, set `SECRETS_KEK_V1` (the command is in `.env.example`) and `INVOICE_PROVIDER=nwc`. Keep the same key afterwards: it decrypts the stored connections.
3. Link the wallet to the demo shop. The command asks for the link without showing it; it is never taken from the command line.

   ```
   pnpm --filter @selly/core cli wallet:link --slug awa-style
   # or, with Docker:
   docker compose exec core node dist/cli.js wallet:link --slug awa-style
   ```

   Selly checks the connection first: its permissions, then a 1-sat test invoice that is never paid. `wallet:status` and `wallet:unlink` work the same way.
4. Start core. Orders now get invoices from that wallet, and a payment shows as paid within seconds.

The dashboard links a wallet with `PUT /api/v1/vendors/me/wallet`. This command stays for operators and for the platform wallet.

## Who owns what

| Dev   | Owns                                                                | Start with                                           |
| ----- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Dev 1 | apps/web, packages/ui                                               | milestones M0 and M1 in architecture.md section 12.3 |
| Dev 2 | apps/agent                                                          | M0 (chat sessions, conversation store), then M2      |
| Dev 3 | apps/core, packages/db, nwc, nostr, money, contracts, docs/api.json | M0 and M1 (orders, NWC gateway)                      |

Nobody edits another owner's folder without their review (see `.github/CODEOWNERS`).

## Testing against core from another package

Add `"@selly/core": "workspace:*"` to `devDependencies` and import from `@selly/core/testing`: `createTestApp`,
`createShop`, `createVendorSession` (a session cookie for a vendor), `orderPayload`, `reconcileOnce`, `dispatchOnce`,
`assertContract` and others. Core then runs in-process on PGlite with a fake wallet and a clock the test controls.

## Working agreements

- Work against the contract. If an endpoint must change, change `docs/api.json` and `docs/architecture.md` section 5 in the same pull request, and ask the consumers' owners to approve.
- Branch from `main`, open a pull request, keep it small. CI runs lint, typecheck, tests, build and the OpenAPI lint.
- Before the real endpoints exist, mock against `docs/api.json` (for example with Prism: `npx @stoplight/prism-cli mock docs/api.json`).
- Never commit secrets, NWC URIs (`nostr+walletconnect://`) or Nostr secret keys (`nsec1...`).

## Commands

```
pnpm dev          # all apps
pnpm lint         # Biome
pnpm format       # Biome, write fixes
pnpm typecheck
pnpm test
pnpm build
```
