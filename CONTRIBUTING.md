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

## Who owns what

| Dev   | Owns                                                                | Start with                                           |
| ----- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Dev 1 | apps/web, packages/ui                                               | milestones M0 and M1 in architecture.md section 12.3 |
| Dev 2 | apps/agent                                                          | M0 (chat sessions, conversation store), then M2      |
| Dev 3 | apps/core, packages/db, nwc, nostr, money, contracts, docs/api.json | M0 and M1 (orders, NWC gateway)                      |

Nobody edits another owner's folder without their review (see `.github/CODEOWNERS`).

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
