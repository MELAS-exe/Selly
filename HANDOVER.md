# Handover notes — vendor storefront (Slice A/B/C)

> Written at the end of a session so the next developer can pick up exactly where things left off.
> Delete this file once everything below is done and merged.

---

## What is done and pushed (on `main`)

### Slice A — backend: branding, banner, categories

- **`core.categories` table**: vendors own a list of named, ordered categories (`GET/POST/PATCH/DELETE /api/v1/vendors/me/categories`, reorder via `PUT /api/v1/vendors/me/categories/order`). Deleting a category unlinks its products (they become uncategorised), never deletes them.
- **`products.category_id`**: the old free-text `products.category` column is gone. Products now carry a nullable FK to `core.categories`. Photo-to-product draft confirmation (`apps/core/src/modules/inventory/drafts.ts`) does a find-or-create by name, so the vision model's free-text category guess is preserved.
- **`vendors.settings.branding`**: logo (processed through the same image pipeline as product photos, stored as a public CDN key), `primary_color`, `accent_color` (both hex), and an optional `banner: { text, href }`. Set via `PATCH /api/v1/vendors/me` with `settings.branding`.
- **Public storefront contract** (`GET /api/v1/stores/:slug`): now returns `branding` (logo_url, colors, banner) and `categories` alongside delivery/hours/chat.
- **`docs/api.json`** updated to match — `StoreProfile`, `VendorSettings`, `ProductSummary`, `ProductDetail`, `VendorProduct`, plus new `Branding`, `CategorySummary`, `Category`, `CategoryRequest` schemas and all 5 category endpoints documented.
- Migrations `0010` and `0011` applied to the dev database; demo seed creates 3 categories (Robes, Chaussures, Sacs) and a sample banner/colors on `awa-style`.
- All 120 core tests + 102 agent tests pass.

### Slice B — vendor storefront (`/s/[slug]`)

- **Brand colors as CSS variables**: `brandStyle(branding)` in `src/lib/brand-colors.ts` maps `primary_color`/`accent_color` to `--color-indigo`/`--color-indigo-deep`/`--color-ochre`, injected as inline `style` on the shop root so the wax band, buttons and chips all use the vendor's colors without a re-build.
- **Logo** shows next to the shop name in the header (rounded, 32 px, falls back to text-only if no logo set).
- **Banner strip** between the wax band and the header, in the accent color, with an optional link.
- **Category nav**: horizontal chip list (Tout + each category), server-rendered links that filter the catalog via `?category=slug`. Works without JavaScript.
- **`?category=`** wired into `getStore()` in `src/lib/core.ts` and `StorePage`.
- **`SiteHeader`** component extracted (`src/components/brand/site-header.tsx`): one source of truth for the header across the landing page, `/tarifs`, `/app/login`, and `/app/onboarding`.

### Slice C — customer chat widget (partially done — see below)

- **`src/lib/chat-types.ts`**: TypeScript types for `ChatMessage`, `ChatSession`, `ProductCard`, `OrderCard`, `QuickReply` matching `docs/api.json`.
- **`src/lib/chat.ts`**: `ensureSession` (create or resume from localStorage, stores `disclosure`/`store`/`features` as well as the token), `sendMessage`, `listMessages`, `subscribe` (fetch-based SSE reader with 5-second polling fallback when the stream fails twice).
- **`src/lib/chat.test.ts`**: 5 unit tests covering session creation, resume, expiry, and server-side revocation — all passing.
- **`src/app/api/v1/chat/events/route.ts`**: a streaming Next.js Route Handler that proxies the agent's SSE endpoint. This exists because Next's `rewrites()` config buffers a proxied response and never flushes it (confirmed empirically — the first byte never arrives through the rewrite); the Route Handler passes the `ReadableStream` directly and streams immediately.
- **`src/components/chat/ask-selly.tsx`**: the trigger button — floating (every shop/product page) and inline (`variant="inline"`, on the product detail page below the add-to-cart). Both open `ChatPanel`.
- **`src/components/chat/chat-panel.tsx`**: the full chat UI — session loading, greeting bubble, live SSE replies, typing indicator, quick-reply chips, product and order cards, the message input bar.

---

## What is NOT done yet

### 1. Chat greeting bubble not rendering — fix is committed but unverified

**Root cause found**: `addMessages` used a `useRef(new Set())` for deduplication. React Strict Mode double-invokes effects in dev (mount → cleanup → remount), and both runs called `ensureSession`, which returned the same greeting message id. The first run populated the `seen` Set, then the effect cleanup set `active = false` and aborted its own state updates — but the `seen` Set survived on the ref. The second run's `addMessages` call saw the id already in `seen` and skipped the push, leaving `messages` empty.

**Fix applied** (in this commit): replaced the external `seen` ref with an inline dedup inside `setMessages`'s updater:

```ts
setMessages((prev) => {
  const existing = new Set(prev.map((m) => m.id));
  const toAdd = incoming.filter((m) => !existing.has(m.id));
  return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
});
```

This works correctly under Strict Mode because each updater call sees the actual committed state, not a ref that survived an aborted render cycle.

**Status**: fix is in this commit, but could not be visually verified before credits ran out. Needs a quick manual or automated check:

1. `pnpm --filter @selly/web dev` and `pnpm --filter @selly/core dev` and `pnpm --filter @selly/agent dev` all running.
2. Open `http://localhost:3000/s/awa-style/p/robe-wax-noire`.
3. Click "Poser une question à Selly".
4. The greeting "Bonjour ! Je suis l'assistant automatique de Awa Style…" should appear in the chat panel with two quick-reply chips.
5. Type a message and hit Send — the agent (demo mode) should reply.

### 2. Cart page still 404s

`/s/[slug]/cart` has no implementation. This is pre-existing from PR #18 (noted in the original review) and is unrelated to this feature. Someone needs to build it.

### 3. Amber (NIP-55) and NIP-46 bunker signers

The sign-in page only supports NIP-07 browser extension and local key (NIP-49). Amber (Android, same-device via intent) and remote bunker (NIP-46) are deferred. The architecture and the `nostr-signers.ts` module already document this gap.

### 4. Vendor dashboard UI for branding/categories

The API for setting branding, colors, the banner, and managing categories exists and is tested. The dashboard UI pages (under `/app/*`) to actually let vendors do it are not built. Right now you can only set branding/categories by patching the database or calling the API directly with a session cookie.

### 5. MinIO not running locally

`docker compose up -d minio minio-init` fails because the `minio/mc` image requires a `docker login` (rate-limited / auth-walled pull). As a result, `MEDIA_STORE=memory` is used locally, which means uploaded images stay in the core process and are lost on restart. This only affects product photo uploads and the logo upload; everything else works fine. To fix: `docker login` before running `pnpm infra:up`, or use the full `docker compose up --build` stack which builds from a Dockerfile rather than pulling `minio/mc`.

---

## Running the stack locally

```sh
# 1. Infrastructure (postgres + relay; minio optional — see note above)
pnpm infra:up          # starts postgres:18 and the nostr relay

# 2. Services (each in its own terminal)
pnpm --filter @selly/core dev    # port 4000, migrates + seeds on start
pnpm --filter @selly/agent dev   # port 4100
pnpm --filter @selly/web dev     # port 3000

# Demo shop: http://localhost:3000/s/awa-style
# Pricing:   http://localhost:3000/tarifs
# Sign-up:   http://localhost:3000/app/login
```

The `.env` file at the repo root is NOT committed (it holds secrets). It was created this session from `.env.example` with:

- `DATABASE_URL` / `DATABASE_DIRECT_URL` pointing at the local compose postgres (port 5432 after `infra:up`, not the old ad-hoc container on 55434).
- `SECRETS_KEK_V1` set to a generated 32-byte base64 key.
- Everything else at the `.env.example` defaults (`LLM_PRIMARY=demo`, `INVOICE_PROVIDER=fake`, etc.).

---

## Key files changed this session

| Path                                              | What                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/db/src/core/schema.ts`                  | Added `categories` table; `products.categoryId` FK replaces `products.category` text                    |
| `packages/db/migrations/0010_*.sql`, `0011_*.sql` | Additive migration + drop of old column                                                                 |
| `apps/core/src/modules/catalog/categories.ts`     | CRUD service for categories (new file)                                                                  |
| `apps/core/src/modules/catalog/store.ts`          | `storeProfile` now returns `branding` + `categories`; `listProducts` filters by category slug           |
| `apps/core/src/modules/vendors/service.ts`        | `settingsPatch` and `vendorView` include `branding`; logo upload processed via `processUpload`          |
| `apps/core/src/dev/seed.ts`                       | Demo shop now has 3 categories, colors, and a banner                                                    |
| `docs/api.json`                                   | Full contract update (branding, categories, category endpoints)                                         |
| `apps/web/src/lib/brand-colors.ts`                | Maps vendor colors to CSS variables (new file)                                                          |
| `apps/web/src/lib/chat-types.ts`                  | Chat wire types (new file)                                                                              |
| `apps/web/src/lib/chat.ts`                        | Chat client — session, messages, SSE subscribe (new file)                                               |
| `apps/web/src/lib/chat.test.ts`                   | 5 unit tests for session logic (new file)                                                               |
| `apps/web/src/lib/types.ts`                       | `StorePublic` extended with `branding`/`categories`; `ProductSummary`/`ProductDetail` use `category_id` |
| `apps/web/src/components/brand/site-header.tsx`   | Shared header component (new file)                                                                      |
| `apps/web/src/components/category-nav.tsx`        | Category chip nav (new file)                                                                            |
| `apps/web/src/components/chat/ask-selly.tsx`      | Chat trigger button, floating + inline variants (new file)                                              |
| `apps/web/src/components/chat/chat-panel.tsx`     | Full chat panel UI (new file)                                                                           |
| `apps/web/src/app/s/[slug]/layout.tsx`            | Brand colors, logo, banner, AskSelly trigger                                                            |
| `apps/web/src/app/s/[slug]/page.tsx`              | Category nav, `?category=` filter                                                                       |
| `apps/web/src/app/s/[slug]/p/[product]/page.tsx`  | Inline AskSelly CTA                                                                                     |
| `apps/web/src/app/api/v1/chat/events/route.ts`    | Streaming SSE pass-through (bypasses rewrite buffering)                                                 |
| `apps/web/next.config.ts`                         | Comment noting why the events route handler exists                                                      |
