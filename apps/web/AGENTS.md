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
