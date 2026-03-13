# Coolify Deployment

This repo now includes a root `Dockerfile` for deploying `apps/web` on Coolify.

## Service layout

- Deploy only the web app with the root `Dockerfile`.
- Provision PostgreSQL separately and point `DATABASE_URL` at it.
- Provision Redis separately and point `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` at it.

## Coolify settings

- Build pack: `Dockerfile`
- Dockerfile location: `/Dockerfile`
- Build context: `/`
- Port: `3000`

The container runs `prisma migrate deploy` before it starts the Next.js standalone server.

## Environment

Use `apps/web/.env.example` as the source of truth for runtime variables.

Some auth and Redis-backed code runs during `next build` while page data is collected. If those env vars are missing during the image build, the build may still finish but it will emit warnings.

At minimum, set:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Add the optional API keys from `apps/web/.env.example` for any enabled integrations such as OpenRouter, Anthropic, Polar, Sentry, Inngest, E2B, Mixedbread, or SuperMemory.
