# syntax=docker/dockerfile:1
# Build context is the repository root:  docker build -f apps/web/Dockerfile .

FROM node:24-alpine AS base
RUN npm install -g pnpm@10.34.9
ENV PNPM_HOME=/pnpm
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@selly/web..."
# Next.js bakes the /api/v1 rewrites into the build, so these must be known here.
ARG CORE_URL=http://core:4000
ARG AGENT_URL=http://agent:4100
ENV CORE_URL=$CORE_URL AGENT_URL=$AGENT_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @selly/web build

FROM node:24-alpine AS runtime
# The server pages and the chat stream read them at run time too (src/lib/core.ts).
ARG CORE_URL=http://core:4000
ARG AGENT_URL=http://agent:4100
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 \
    CORE_URL=$CORE_URL AGENT_URL=$AGENT_URL
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
