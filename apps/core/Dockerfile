# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/core/Dockerfile .

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.9
ENV PNPM_HOME=/pnpm
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@selly/core..."
RUN pnpm --filter @selly/core build
# Production dependencies only. Workspace packages are bundled into dist by tsup.
RUN pnpm --filter @selly/core --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production CORE_PORT=4000 MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/core/dist ./dist
# SQL migrations, applied at start when MIGRATE_ON_START=true.
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
