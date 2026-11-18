# apps/web: notes for agents

Contracts with core that live outside `docs/api.json`. Read them before you build the dashboard, its routes or
its service worker. If you change one of these, change core in the same PR (or open one for it).

## Dashboard routes that core links to

Core's alerts (Web Push, Nostr direct messages) open these paths. They must exist and keep these names:

| Path                                 | Opened by                                                            |
| ------------------------------------ | -------------------------------------------------------------------- |
| `/app/commandes/<order id>`          | a paid order (`order.paid`)                                          |
| `/app/discussions/<conversation id>` | a handoff or a new chat (`conversation.handoff`, `conversation.new`) |
| `/app/abonnement`                    | renewal reminders, grace, suspension (`subscription.updated`)        |
| `/app/portefeuille`                  | a wallet that stopped answering (`wallet.degraded`)                  |

The links are built in `apps/core/src/modules/events/alerts.ts` (`alertFor`), as `APP_BASE_URL` + path. The agent's
notifications carry the same discussion path in their `url` field.

## Web Push

- **Key.** Subscribe browsers with `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, where
  the key is `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. It must be the same value as core's `VAPID_PUBLIC_KEY`
  (`npx web-push generate-vapid-keys` makes a pair; the private key stays in core).
- **Register.** Send the subscription to `POST /api/v1/vendors/me/push-subscriptions` (`endpoint`, `keys.p256dh`,
  `keys.auth`, `expiration_time`). Do it after the vendor allows notifications in the installed PWA.
- **Payload.** Core sends JSON: `{ "title": string, "body": string, "url": string, "tag": string }`, already in
  French. The service worker shows `title` and `body` with `tag` (a newer alert with the same tag replaces the older
  one), and on click focuses an open dashboard tab or opens `url`.
- **Opt out.** `settings.alerts.web_push` (`PATCH /api/v1/vendors/me`) turns pushes off; the live stream
  (`GET /api/v1/vendors/me/events`) still shows everything.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## The dashboard (`/app`)

- Pages live in `src/app/app/(dash)/`, components in `src/components/dashboard/`. Every read and write goes through
  `useDashboard()` / `useResource()` (`data.tsx`): a 401 sends the vendor to `/app/login`, a vendor without a shop to
  `/app/onboarding`, and every write or live event refreshes what is on screen.
- Live updates come from `GET /api/v1/vendors/me/events` (the whole dashboard) and
  `GET /api/v1/conversations/{id}/events` (the open thread), through the rewrites: `compress: false` in
  `next.config.ts` keeps Next's gzip from buffering them.
- The interface is the Replit draft in the landing page's design system; text colours read the `d-*` tokens of
  `globals.css` (AA on paper). The PWA (`sw.js`, `manifest.ts`, `/app-offline.html`) and Web Push (`push.tsx`) come
  from the first dashboard (PR #30).
- `?demo` on any dashboard URL (or `NEXT_PUBLIC_DASHBOARD_DEMO=1`) answers from `demo.ts` instead of core, for
  presentations. Keep its data in core's shapes when the contract changes.
- `POST /inventory`, `/inventory/restock-ai` and `/vendors/me/subscription/invoices` need an `Idempotency-Key`
  (16 to 64 characters): use `newKey()`.
