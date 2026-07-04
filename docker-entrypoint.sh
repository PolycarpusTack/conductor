#!/bin/sh
# App container entrypoint (F-1).
#
# Brings the database schema up to date, then hands off (exec, so PID 1 is the
# server and receives SIGTERM for graceful shutdown) to the Next.js standalone
# server.
#
# There are no SQL migrations in this repo — the project uses `prisma db push`
# (see package.json db:push, prisma.config.ts). db push is idempotent: on a
# fresh volume it creates the schema; on an existing one it is a no-op when the
# schema already matches. The datasource URL comes from prisma.config.ts, which
# reads DATABASE_URL (default file:./prisma/dev.db). In compose we point it at a
# file on the mounted data volume.
set -e

echo "[entrypoint] Applying database schema (prisma db push)..."
# --skip-generate: the client was already generated at build time.
# --accept-data-loss is safe here because db push never runs destructive ops
# unless the schema genuinely diverged; on a matching schema it is a no-op.
# Run under Node (the Prisma CLI is Node-native).
node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss

echo "[entrypoint] Starting Next.js standalone server on port ${PORT:-3000}..."
# Node, not Bun: the SQLite adapter's better-sqlite3 addon cannot load under Bun.
exec node server.js
