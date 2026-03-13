# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.5 AS base
WORKDIR /workspace

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM deps AS build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN bun run --cwd apps/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./.next/static
COPY --from=build /workspace/apps/web/public ./public

COPY --from=prod-deps /workspace/package.json /workspace/package.json
COPY --from=prod-deps /workspace/node_modules /workspace/node_modules
COPY --from=build /workspace/apps/web/package.json /workspace/apps/web/package.json
COPY --from=build /workspace/apps/web/prisma /workspace/apps/web/prisma

COPY docker/start-web.sh /usr/local/bin/start-web
RUN chmod +x /usr/local/bin/start-web

EXPOSE 3000

CMD ["start-web"]
