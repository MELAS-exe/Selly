# @selly/agent

The sales agent and the vendor assistant (architecture.md §3.8 and §8). Fastify, TypeScript, one engine with two roles.

## Run it

```sh
pnpm install
pnpm --filter @selly/agent dev        # http://localhost:4100
pnpm --filter @selly/agent test
```

Three switches choose the dependencies, so web can work against the agent before core exists:

| Variable          | Values                                                      | Default                      |
| ----------------- | ----------------------------------------------------------- | ---------------------------- |
| `AGENT_CORE_MODE` | `fake`: an in-memory core with a demo shop `awa-style`      | real core at `CORE_URL`      |
| `AGENT_STORE`     | `memory`: no database                                       | PostgreSQL at `DATABASE_URL` |
| `LLM_PRIMARY`     | `scripted` (tests), `demo` (rule-based, no key), `claude-…` | `scripted`                   |

`.env.example` sets `fake`, `memory` and `demo`: open a chat on `awa-style` and ask « robe noire en 42 ? ». For the real agent, set `LLM_PRIMARY=claude-opus-5-5` and `ANTHROPIC_API_KEY` (or sign in with `ant auth login`). `LLM_FALLBACK` names a second provider, used once when the first one fails.

With PostgreSQL, create the `agent` schema first: `pnpm --filter @selly/db db:migrate`. The agent refuses to start without it.

The fake core's vendor session cookie is `selly_session=dev-vendor-session`, for the inbox and the assistant.

## Endpoints

All of docs/api.json tags Chat, Inbox and Assistant, plus `POST /internal/v1/events` and `POST /internal/v1/agent/chat`.

| Path                                            | Notes                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/chat/sessions`                    | 201 with the token, the disclosure and the greeting. 404, 403 `STORE_PAUSED` or `CHAT_UNAVAILABLE`.                                                                                   |
| `POST /api/v1/chat/messages`                    | 202 at once. The reply arrives on the stream. A repeated `client_message_id` runs no second turn.                                                                                     |
| `GET /api/v1/chat/events`                       | SSE (`message`, `typing`, `mode`). Use `fetch` streaming (bearer token), resume with `Last-Event-ID`.                                                                                 |
| `GET /api/v1/chat/messages?after=`              | Catch-up when the stream drops.                                                                                                                                                       |
| `POST /api/v1/chat/uploads`, then `PUT` the URL | Voice notes. The upload URL is served by the agent, which forwards the bytes to core (`/internal/v1/media`).                                                                          |
| `/api/v1/conversations…`                        | Inbox, thread, SSE (`read` as well), vendor message (switches to `human` for 30 min), mode.                                                                                           |
| `/api/v1/assistant/messages`                    | Vendor assistant, reply in the same response (20 s budget).                                                                                                                           |
| `POST /internal/v1/events`                      | HMAC `X-Selly-Signature`. `order.paid/expired/cancelled/fulfilled` post a system message in the chat; `draft.requested` runs the extraction; `entitlements.changed` clears the cache. |
| `POST /internal/v1/agent/chat`                  | One synchronous turn with the tool calls. Service token; disabled in production.                                                                                                      |

Errors are `application/problem+json` with the codes of `packages/contracts`.

## Layout

```
src/
  app.ts               wiring (store, core client, LLM provider, services, routes)
  chat/                HTTP routes, auth (chat token, vendor cookie, service token, HMAC), SSE hub
  conversations/       messages and the mode machine (§4.4); turns.ts = one turn at a time, 1.5 s merge, quotas, voice, handoff
  engine/              the tool loop (4 rounds, 12 s), prompts, output filter, providers (Claude, scripted, demo)
  tools/               the 7 sales tools and 9 vendor tools of §8.3, chosen by role
  vision/              product extraction from photos (structured output, ADR-12)
  asr/                 speech to text interface (no provider yet: the agent asks for a written message)
  quota/               entitlements cache (60 s, 10 min stale on failure), usage, rate limits
  core/                typed client of core's internal API, and the fake core
  store/               memory and PostgreSQL (Drizzle schema in packages/db/src/agent)
```

## Guardrails in code, not only in the prompt

- Every path segment sent to core is validated (UUID, or a short reference): a model-supplied id such as `../vendors/OTHER/orders/A7K2` never reaches a URL. Tool ids are `z.uuid()`.
- In production the agent refuses to start with a missing, short or development `SERVICE_TOKEN_AGENT` or `EVENTS_HMAC_SECRET`, unless `ALLOW_DEV_SECRETS=true` (the local compose sets it). `POST /internal/v1/agent/chat` needs `AGENT_TEST_ENDPOINT=true`, which production refuses.
- A customer can only ask the status of orders created in their own conversation.
- `X-Forwarded-For` is trusted only for `TRUST_PROXY` hops (default 0).

- The vendor id never comes from the model or the browser: it is fixed when the session opens.
- A customer conversation only gets the sales tools.
- `create_order` takes `expected_total` from the last `quote_cart`, and refuses items or delivery that differ from it. Its `Idempotency-Key` is derived from the quote and the customer, so a retry never creates a second order.
- Discounts are capped by core (`quote_cart`), whatever the model asks.
- Every amount in a reply must appear in this turn's tool results or in the visible conversation (property P5). Otherwise the model gets one chance to fix it, then the turn ends with the fixed reply and a handoff.
- Links only to our domain and the vendor's WhatsApp, no other phone numbers, 1,000 characters at most.

## Points for Dev 3 (core) to check

1. **Schema `agent`** (`packages/db/src/agent/schema.ts`, migration `0004_agent_schema.sql`, after the core migrations). Three additions to §4.3: `messages.author_label`, `messages.image_keys`, `messages.quick_reply_id`, and a `processed_events` table for core event deduplication. Ids are generated by the application (UUIDv7), like the core schema, so the migration also runs on PGlite.
2. **Discounts.** `create_order` sends the `discount_pct` of the last `quote_cart`; core caps it again and requires `expected_total` to equal its own total (#2). The fake core does the same.
3. **Images for extraction.** Image keys must start with `vendors/<vendor id>/` (no `..`, `?` or `#`); the agent refuses any other key. It turns a key into `MEDIA_BASE_URL/<key>` until core provides a presigned read URL.
4. **Events.** `checkout_url` from `order.*` events is used only when it is on our own domain under `/c/`; otherwise the agent uses the URL it saved when it created the order.
5. **Usage.** Customer replies count as `agent_turns`, photo drafts as `drafts`. Vendor assistant messages are not counted as agent turns.

## Points for Dev 1 (web)

- The assistant's draft questions come back as `quick_replies` (`id` like `stock_split:1`). Send the tapped id as `quick_reply_id`.
- A message with only `quick_reply_id` (no text) is fine: the agent uses the button's label.
- Payment confirmations arrive as `author: "system"` messages with an order card.

## Limits of this version

- The SSE hub, the turn scheduler, the rate limits and the "pause all chats" switch are in memory: run **one** agent instance, and a restart forgets a pause. Before several instances: LISTEN/NOTIFY for the hub, `pg_advisory_xact_lock` per conversation for turns, and the pause stored in PostgreSQL.
- No speech-to-text provider yet (Wolof must be measured first, F9): voice notes get « pouvez-vous l'écrire ? ».
- The « Annuler » button for large price changes or stock set to 0 (§8.4) is not built yet; the assistant reminds the vendor they can correct it.
- The PostgreSQL store is tested by `store.test.ts` on PGlite (every migration applied), and on a real PostgreSQL when `TEST_DATABASE_URL` is set.
