#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"

export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export PORT="${PORT:-3000}"

cd /workspace/apps/web
echo "Running Prisma migrations..."
../../node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma

cd /app
echo "Starting Next.js on ${HOSTNAME}:${PORT}..."
exec node server.js
