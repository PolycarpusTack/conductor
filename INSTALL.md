# Conductor — Self-Host Install Guide

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- Node.js 20+ (used by the Next.js build; native module builds need working
  build tools — on Windows, "Desktop development with C++" from VS Build Tools)
- Git
- Docker (optional — only for the PostgreSQL + pgvector setup)

## 1. Clone and install

```bash
git clone <your-repo-url> conductor
cd conductor
bun install        # also runs `prisma generate` via postinstall
```

## 2. Configure environment

Copy the example file and fill in values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | Defaults to SQLite at `file:./prisma/dev.db`. Use `postgresql://…` for Postgres. |
| `AGENTBOARD_ADMIN_PASSWORD` | Production | Dashboard login password, min 8 chars. Without it the admin UI is locked out. |
| `AGENTBOARD_ADMIN_SESSION_SECRET` | No | Separate cookie-signing secret (min 16 chars); falls back to the admin password. Generate: `openssl rand -hex 16` |
| `AGENTBOARD_WS_SECRET` / `AGENTBOARD_WS_INTERNAL_SECRET` | No | Shared secrets for the `board-ws` realtime mini-service (min 16 chars each). |
| `PROMPT_LIBRARY_PATH` | No | Absolute path to a folder of `.md` prompt templates for the archive browser / agent wizard. |
| `OPENAI_API_KEY` | No | Enables the agent wizard LLM composition and memory embeddings. |

Environment is validated at server startup (`src/lib/env.ts`) — a
misconfigured deployment fails at boot with a readable message instead of a
runtime error on first request.

## 3. Database

**SQLite (default):**

```bash
bun run db:push
```

**PostgreSQL + pgvector (enables semantic memory/skill search):**

```bash
bun run docker:up                                   # starts pgvector/pgvector:pg17 on :5432
# set DATABASE_URL=postgresql://conductor:conductor_dev@localhost:5432/conductor
bun run db:push
```

## 4. Start

**Development:**

```bash
bun run dev        # http://localhost:3000
```

**Production:**

```bash
bun run build      # next build + standalone copy
bun run start      # serves .next/standalone via bun
```

## 5. Realtime updates (optional)

Live board sync runs through the `mini-services/board-ws` Socket.IO service
(port 3003). Set both `AGENTBOARD_WS_*` secrets in the app **and** the
service's env, then:

```bash
cd mini-services/board-ws
bun install && bun run start
```

Without it the board falls back to manual refresh — everything else works.

## 6. Verify

```bash
curl http://localhost:3000/api/health
```

Expected: `{"status":"ok","db":"ok","env":"ok",...}` — returns HTTP 503 with
the failing component when degraded.

Per-runtime LLM connectivity can be checked from an admin session via
`GET /api/admin/runtimes/<id>/health` (fires one tiny echo prompt and
reports latency).

## Upgrading

```bash
git pull
bun install
bun run db:push
bun run build
bun run start
```
