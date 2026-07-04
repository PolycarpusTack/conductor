# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# AgentBoard / Conductor — web app image (F-1)
#
# Multi-stage build on the Bun runtime.
#   builder  — installs deps (compiling the better-sqlite3 NATIVE module),
#              generates the Prisma client, runs `next build` + copy-standalone.
#   runner   — minimal image that runs the Next.js standalone server.
#
# Runtime note: the default SQLite adapter uses better-sqlite3, which REFUSES to
# run under Bun ("'better-sqlite3' is not yet supported in Bun"). So we build
# with Bun (fast install + `next build`) but RUN the server under Node. The
# better-sqlite3 addon fetched during `bun install` is an N-API prebuild and is
# ABI-compatible with Node (verified: Node loads the Bun-installed binary).
#
# Native-module note: Next's standalone file-tracing frequently MISSES native
# .node binaries, so we copy node_modules/better-sqlite3 (and the Prisma
# adapter/client) into the runner explicitly. Both stages are Debian/glibc based
# (NOT alpine/musl) so the addon stays ABI-compatible.
# ---------------------------------------------------------------------------

# ----------------------------- builder -------------------------------------
FROM oven/bun:1 AS builder

# Toolchain for compiling better-sqlite3 from source (node-gyp: python3/make/g++).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Prisma schema + config must exist before install: `postinstall` runs
# `prisma generate`, which reads prisma/schema.prisma and prisma.config.ts and
# writes the client to src/generated/prisma.
COPY package.json bun.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# Installs deps AND compiles better-sqlite3 (toolchain present above).
RUN bun install --frozen-lockfile

# App source (src/generated is .dockerignore'd so the fresh client survives).
COPY . .

# Browser realtime URL is inlined into the client bundle at build time. Leave
# empty for API-only / same-origin setups; set to the public board-ws URL to
# enable live board updates in the browser.
ARG NEXT_PUBLIC_AGENTBOARD_WS_URL=""
ENV NEXT_PUBLIC_AGENTBOARD_WS_URL=${NEXT_PUBLIC_AGENTBOARD_WS_URL}

# Regenerate defensively (cheap; guarantees the client matches the schema even
# if postinstall was skipped by the lockfile cache), then build.
RUN bun run db:generate \
  && bun run build

# ----------------------------- runner --------------------------------------
# Node (not Bun): runs the standalone server + `prisma db push`. node:bookworm
# already bundles libssl3 (needed by the Prisma schema engine) and ca-certificates.
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone server bundle (server.js + traced node_modules + .next/static +
# public are all placed under .next/standalone by copy-standalone.mjs).
COPY --from=builder /app/.next/standalone ./

# Explicit native/runtime deps that standalone tracing can miss.
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
# Generated Prisma client (imported via @/generated/prisma).
COPY --from=builder /app/src/generated ./src/generated

# Needed by the entrypoint's `prisma db push`.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Hits the real health endpoint (200 = ok, 503 = degraded). Uses Node's global
# fetch (Node 18+) so no curl/wget dependency is required in the slim image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
