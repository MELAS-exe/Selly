# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/agent/Dockerfile .

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.9
ENV PNPM_HOME=/pnpm
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@selly/agent..."
RUN pnpm --filter @selly/agent build
# Production dependencies only. Workspace packages are bundled into dist by tsup.
RUN pnpm --filter @selly/agent --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production AGENT_PORT=4100
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/agent/dist ./dist
USER node
EXPOSE 4100
CMD ["node", "dist/index.js"]
