# @selly/agent

The sales agent and the vendor assistant (architecture.md §3.8 and §8). Fastify, TypeScript, one engine with two roles.

## Run it

```sh
pnpm install
pnpm --filter @selly/agent dev        # http://localhost:4100
pnpm --filter @selly/agent test
```

Three switches choose the dependencies:

| Variable          | Values                                                                                                         | Default                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `AGENT_CORE_MODE` | `fake`: an in-memory core with a demo shop `awa-style`                                                         | real core at `CORE_URL`      |
| `AGENT_STORE`     | `memory`: no database                                                                                          | PostgreSQL at `DATABASE_URL` |
| `LLM_PRIMARY`     | `scripted` (tests), `demo` (rule-based, no key), `video` (the demo video's lines, video/README.md), `claude-…` | `scripted`                   |

`.env.example` and the compose use the real core and PostgreSQL (`pnpm dev` or `docker compose up`: core migrates, the agent schema included, and loads the demo shop) with the `demo` model: open a chat on `awa-style` and ask « robe noire en 42 ? ». For the real agent, set `LLM_PRIMARY=claude-opus-5-5` and `ANTHROPIC_API_KEY` (or sign in with `ant auth login`). `LLM_FALLBACK` names a second provider, used once when the first one fails.

With PostgreSQL the agent waits up to 60 seconds for the `agent` schema (core creates it at start with `MIGRATE_ON_START=true`, or run `pnpm --filter @selly/db db:migrate`), then stops with a clear message.

Vendor sessions for the inbox and the assistant come from core's Nostr sign-in; the agent checks the `selly_session` cookie with `POST /internal/v1/sessions/introspect`. Only the fake core (`AGENT_CORE_MODE=fake`, for agent work without core) accepts `selly_session=dev-vendor-session` instead.

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

## The real core

`src/e2e/real-core.test.ts` runs the agent's HTTP client against core's app (`@selly/core/testing`: PGlite, simulated wallet, in-memory storage) and core's outbox dispatcher against the agent's app. Each test has its own shop, so they pass alone and in any order. They cover:

- the customer chat: session by slug, search, product detail, negotiated quote (capped at 10 %), order with `discount_pct`, payment settled by core, `order.paid` delivered and shown in the chat, order status;
- the vendor tools: stock, price, orders, fulfilment, metrics;
- the inbox and the assistant on a real vendor session (`sessions/introspect`), and another vendor's session getting 404;
- a photo in the assistant: upload to `/internal/v1/media`, draft, confirmation, new product in core's catalog;
- a dashboard draft: `draft.requested` with core's private image links, extraction, draft back in `needs_review`;
- a customer voice note stored in core, transcribed, and the handoff alert in `vendor_notifications`;
- another shop's product (404), an invalid or unknown vendor id, and events signed with another secret.

Also checked by hand with real processes on PostgreSQL 18: core's migrations create the `agent` schema, the chat answers from core's demo catalog over SSE, and core delivers signed events to the agent.

Core serves every internal route the agent uses.

## Points for Dev 3 (core) to check

1. **Schema `agent`** (`packages/db/src/agent/schema.ts`, migration `0004_agent_schema.sql`, after the core migrations). Three additions to §4.3: `messages.author_label`, `messages.image_keys`, `messages.quick_reply_id`, and a `processed_events` table for core event deduplication. Ids are generated by the application (UUIDv7), like the core schema, so the migration also runs on PGlite.
2. **Discounts.** `create_order` sends the `discount_pct` of the last `quote_cart`; core caps it again and requires `expected_total` to equal its own total (#2). The fake core does the same.
3. **Images for extraction.** Image keys must start with `vendors/<vendor id>/` (no `..`, `?` or `#`), as core's uploads do; the agent refuses any other key. For dashboard drafts it uses the private links of `draft.requested` (`image_urls`). For photos sent in the assistant chat it still builds `MEDIA_BASE_URL/<key>`: core could give the agent a read link there too.
4. **Events.** `checkout_url` from `order.*` events is used only when it is on our own domain under `/c/`; otherwise the agent uses the URL it saved when it created the order.
5. **Alerts.** The `url` of a vendor notification is a dashboard path (`/app/conversations/<id>`), as core requires.
6. **Usage.** Customer replies count as `agent_turns`, photo drafts as `drafts`. Vendor assistant messages are not counted as agent turns.

## Points for Dev 1 (web)

- The assistant's draft questions come back as `quick_replies` (`id` like `stock_split:1`). Send the tapped id as `quick_reply_id`.
- A message with only `quick_reply_id` (no text) is fine: the agent uses the button's label.
- Payment confirmations arrive as `author: "system"` messages with an order card.

## Several agent instances

Turns, live events and the bot pause work across instances when the agent uses PostgreSQL:

- **One turn at a time per chat**: a session-level advisory lock per conversation, on its own connection (`store/postgres.ts`).
- **Live events**: each instance publishes its events with `pg_notify('agent_events', ...)` and listens on the same channel (`chat/bus.ts`). Events larger than one NOTIFY travel as the message id and are read from the store. Event ids follow the clock, so `Last-Event-ID` works on any instance.
- **"Pause all chats"**: stored in `agent.vendor_settings` (migration `0005`), so it holds for every instance and survives a restart.

Checked with two agent processes on PostgreSQL 18: a reply produced on one instance reached a stream open on the other, and simultaneous messages sent to both instances got exactly one reply per burst.

## « Annuler » (section 8.4)

After a price change over 30 % or a stock set to 0, the assistant's reply carries an « Annuler » button for 5 minutes. The undo runs in code (no model call), with the value saved before the change.

## Evaluation (section 12.4)

`eval/cases.ts` holds 100 cases on the demo shop: French, English, Wolof, mixed, typos, voice transcripts, negotiation, orders over several turns, handoffs, off-topic requests, prompt injections and vendor commands. Each case says which tools the turn must (and must not) call, the facts the reply must contain, and the language.

```sh
pnpm --filter @selly/agent eval -- --limit 10          # start small: every run is billed
pnpm --filter @selly/agent eval -- --only wo-,mix-     # some cases only
pnpm --filter @selly/agent eval -- --model claude-sonnet-5-5
```

It needs `ANTHROPIC_API_KEY`. The report (`eval/results/`, not committed) gives the pass rate, correct tools and arguments, facts, handoffs, reply language, latency p50 and p95, and the cost per reply against the 0.004 EUR the plans assume (`EUR_PER_USD`, 0.9 by default). The Wolof and mixed cases were written by a non-native speaker: a native speaker must check them before those scores count.

## Speech to text

`ASR_URL` points the agent at any HTTP service that takes the audio bytes and answers `{ text, confidence, language }` (`src/asr/index.ts`), for example a small server around Omnilingual ASR (F9). Before switching it on, measure it on labelled voice notes recorded by native speakers: `eval/asr/labels.json` and the audio files, then `pnpm --filter @selly/agent asr-eval` gives the word error rate per language. Without `ASR_URL`, voice notes get « pouvez-vous l'écrire ? ».

## Limits of this version

- Voice notes are kept in the instance that received the upload until the turn reads them: with several instances, the upload and the message must reach the same one (sticky routing on the chat token) until core's `/internal/v1/media` lets any instance read them back.
- Rate limits are per instance: with n instances a customer gets n times the limit.
- No speech-to-text service is chosen yet: there are no labelled Wolof voice notes to measure one on.
- The PostgreSQL store is tested on PGlite (every migration applied) and on a real PostgreSQL when `TEST_DATABASE_URL` is set.
