# syntax=docker/dockerfile:1
# The demo service of docker-compose.yml (infra/demo/run.mjs): the fake wallets and the Maison Sokhna seed, run
# from the sources with tsx. Build context is the repository root. Local demo only, never in production.

FROM node:24-alpine
# psql: the seed backdates the demo sales straight in the database.
RUN apk add --no-cache postgresql-client && npm install -g pnpm@10.34.9
ENV PNPM_HOME=/pnpm
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@selly/core..."
CMD ["node", "infra/demo/run.mjs"]
