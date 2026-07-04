# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# AgentBoard / Conductor — board-ws realtime service (F-1)
#
# Small Bun image running mini-services/board-ws/index.ts.
#
# IMPORTANT: build this with the REPO ROOT as the build context (compose does
# this via `dockerfile: mini-services/board-ws/Dockerfile`). index.ts imports
# `../../src/lib/server/realtime`, which in turn imports `@/lib/server/logger`.
# So the image must reproduce the repo layout: /app/src, /app/tsconfig.json
# (for the `@/*` -> ./src/* path alias Bun reads), and /app/mini-services/
# board-ws. Only socket.io + Node built-ins are actually loaded at runtime.
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim

WORKDIR /app

# Install board-ws deps (socket.io) first for layer caching.
COPY mini-services/board-ws/package.json ./mini-services/board-ws/package.json
RUN cd mini-services/board-ws && bun install

# Path-alias config + app source the service imports (realtime.ts, logger.ts).
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY mini-services/board-ws/index.ts ./mini-services/board-ws/index.ts

ENV NODE_ENV=production \
    PORT=3003

WORKDIR /app/mini-services/board-ws

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3003)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "index.ts"]
