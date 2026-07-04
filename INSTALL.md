# Conductor — Self-Host Install Guide

Two ways to run Conductor:

- **[Docker (recommended)](#a-docker-one-command-deploy)** — one command brings up
  the web app + realtime service with a persistent database. This is the
  production happy path.
- **[Manual / local](#b-manual--local)** — `bun install` + `bun run dev`, best
  for development and hacking on the code.

> **Runtime note.** The production server (the Next.js *standalone* build) runs
> under **Node**, not Bun: the default SQLite adapter uses `better-sqlite3`,
> which does not load under Bun. Bun is still used for installing, building, and
> the `board-ws` service. Node 20+ is required to serve. The standalone build
> targets **Linux** (Docker / your deploy host); on a Windows dev host use
> `bun run dev` — the standalone server can't run there because NTFS rejects the
> `:` in Turbopack's `node:*` chunk filenames.

---

## A. Docker (one-command deploy)

### Prerequisites

- Docker Engine + Docker Compose v2 (`docker compose version`)

### 1. Configure secrets

```bash
cp .env.example .env
```

Edit `.env` and set — these are **required in production** and the app fails
fast at boot without them (`src/lib/env.ts`):

| Variable | Notes |
|---|---|
| `AGENTBOARD_ADMIN_PASSWORD` | Bootstrap dashboard password, min 8 chars. First login creates the `owner@conductor.local` account. |
| `AGENTBOARD_WS_SECRET` | Shared realtime-token secret, min 16 chars. **Same value** is read by both `app` and `board-ws`. |
| `AGENTBOARD_WS_INTERNAL_SECRET` | Shared server-broadcast secret, min 16 chars. **Same value** in both services. |

Optional: `AGENTBOARD_ADMIN_SESSION_SECRET`, `OPENAI_API_KEY`,
`AGENTBOARD_WS_ALLOWED_ORIGINS` (set explicitly for non-localhost origins).

### 2. Bring the stack up

```bash
docker compose up --build
```

That builds and starts:

- **`app`** — the web app on <http://localhost:3000>. On first start its
  entrypoint runs `prisma db push` to create the schema, then serves.
- **`board-ws`** — the realtime Socket.IO service on port 3003.

The SQLite database is the default and lives on a named Docker volume
(`app_data`, mounted at `/data`, file `/data/app.db`) so it survives container
restarts and rebuilds. Nothing else to provision.

Add `-d` to run detached. Tear down with `docker compose down` (add `-v` to also
delete the data volume — **that erases your database**).

### 3. Browser realtime (optional)

Live board updates in the browser need the client to know the public board-ws
URL, which is **baked at build time**. Set it before building:

```bash
NEXT_PUBLIC_AGENTBOARD_WS_URL=http://localhost:3003 docker compose up --build
```

(For a real domain, point it at wherever the browser reaches board-ws — e.g.
behind the reverse proxy in `Caddyfile`.) Without it, the board falls back to
manual refresh; everything else works.

### 4. Postgres + pgvector (optional, advanced)

SQLite is the turnkey default. A `postgres` compose profile provisions
`pgvector/pgvector:pg17` (with the `vector` extension via
`scripts/init-pgvector.sql`) for semantic memory/skill search:

```bash
# in .env: APP_DATABASE_URL=postgresql://conductor:conductor_dev@postgres:5432/conductor
docker compose --profile postgres up --build
```

> **Caveat (ADR-0004).** The Prisma schema `datasource` provider is hardcoded
> `sqlite`; the runtime *adapter* is what switches to Postgres. That means the
> container's automatic `prisma db push` (which uses the schema provider) does
> **not** create the schema on Postgres out of the box — pointing the app at
> Postgres currently requires flipping the provider to `postgresql` in
> `prisma/schema.prisma` and pushing manually. Treat Postgres as an advanced,
> semantic-search-only enhancement; SQLite is the supported default.

### 5. Optional daemon workers

Daemon workers run steps on machines (often *not* part of this core stack) — see
[`mini-services/conductor-daemon/README.md`](mini-services/conductor-daemon/README.md)
for the reference implementation, registration flow, and session policies. Point
a daemon at the app's URL and register it; it attaches over HTTP.

---

## B. Manual / local

### Prerequisites

- [Bun](https://bun.sh) 1.3+ (install, build, `board-ws`)
- Node.js 20+ (serves the Next.js build; native module builds need working
  build tools — on Windows, "Desktop development with C++" from VS Build Tools)
- Git
- Docker (optional — only for the PostgreSQL + pgvector server)

### 1. Clone and install

```bash
git clone <your-repo-url> conductor
cd conductor
bun install        # also runs `prisma generate` via postinstall
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | Defaults to SQLite at `file:./prisma/dev.db`. Use `postgresql://…` for Postgres. |
| `AGENTBOARD_ADMIN_PASSWORD` | Production | Bootstrap dashboard password, min 8 chars. First login with it creates the `owner@conductor.local` account (same password); after that, sign in with account email + password. |
| `RECOVERY_MODE` | Recovery only | Set to `1` to re-enable legacy password-only login when locked out of all accounts. Unset it after fixing your users. |
| `AGENTBOARD_ADMIN_SESSION_SECRET` | No | Separate cookie-signing secret (min 16 chars); falls back to the admin password. Generate: `openssl rand -hex 16` |
| `AGENTBOARD_WS_SECRET` / `AGENTBOARD_WS_INTERNAL_SECRET` | **Production** | Shared secrets for the `board-ws` realtime mini-service (min 16 chars each). Boot **fails fast** without them in production (otherwise broadcasts silently no-op). Optional in development. |
| `PROMPT_LIBRARY_PATH` | No | Absolute path to a folder of `.md` prompt templates for the archive browser / agent wizard. |
| `OPENAI_API_KEY` | No | Enables the agent wizard LLM composition and memory embeddings. |

Environment is validated at server startup (`src/lib/env.ts`) — a misconfigured
deployment fails at boot with a readable message instead of a runtime error on
first request.

### 3. Database

**SQLite (default):**

```bash
bun run db:push
```

**PostgreSQL + pgvector (enables semantic memory/skill search):**

```bash
docker compose --profile postgres up -d postgres    # pgvector/pgvector:pg17 on :5432
# set DATABASE_URL=postgresql://conductor:conductor_dev@localhost:5432/conductor
bun run db:push                                      # see ADR-0004 provider caveat above
```

### 4. Start

**Development (Bun, hot reload):**

```bash
bun run dev        # http://localhost:3000
```

**Production (Node serves the standalone build):**

```bash
bun run build      # next build + standalone copy (uses Bun)
bun run start      # serves .next/standalone/server.js under Node, cross-platform
```

`bun run start` uses `scripts/start.mjs`, a dependency-free launcher that works
on Windows and Linux: it sets `NODE_ENV=production`, spawns the standalone
server under **Node**, and tees logs to `server.log`. (The old POSIX-only
`NODE_ENV=… bun … | tee` script is gone.) Remember the standalone server itself
only runs on Linux/WSL — see the runtime note at the top.

### 4b. Custom ports & parallel instances

`next dev`/`next start` bind `PORT` (default 3000); board-ws binds its own `PORT`
(default 3003). `PORT` must be set in the **process** environment — Next binds
before it reads `.env`.

A fully isolated second instance needs its own port, database, and realtime
wiring:

```powershell
# instance 2 — PowerShell
$env:PORT=3100
$env:DATABASE_URL="file:./prisma/dev2.db"
$env:AGENTBOARD_WS_URL="http://127.0.0.1:3103"
$env:NEXT_PUBLIC_AGENTBOARD_WS_URL="http://127.0.0.1:3103"
bun run db:push; bun run dev
```

```powershell
# its board-ws — PowerShell
cd mini-services/board-ws
$env:PORT=3103
$env:AGENTBOARD_WS_ALLOWED_ORIGINS="http://localhost:3100,http://127.0.0.1:3100"
bun run start
```

(bash: `PORT=3100 DATABASE_URL=file:./prisma/dev2.db bun run dev` etc.)
Skip the board-ws pair entirely if the second instance doesn't need live sync.

### 5. Realtime updates (board-ws)

Live board sync runs through the `mini-services/board-ws` Socket.IO service
(port 3003). Set both `AGENTBOARD_WS_*` secrets in the app **and** the service's
env (same values), then:

```bash
cd mini-services/board-ws
bun install && bun run start
```

Without it the board falls back to manual refresh — everything else works. (In
Docker this service is built and run for you.)

### 6. Verify

```bash
bun run doctor        # local checks + lenient network checks
bun run smoke-test    # post-deploy gate: server + realtime must answer
```

The doctor checks runtime, env validation, Prisma client, database connectivity,
configured LLM runtimes, daemon presence, and (unless `--offline`) the live
`/api/health` endpoint and the realtime service. Exit code 1 only on hard
failures; `--json` for machines.

Raw health endpoint: `curl http://localhost:3000/api/health` (HTTP 503 with the
failing component when degraded; this is what the Docker `HEALTHCHECK` hits).
board-ws health: `curl http://localhost:3003/healthz`. Per-runtime LLM
connectivity: `GET /api/admin/runtimes/<id>/health` from an admin session.

### 7. Daemons (optional)

Daemon workers run steps on local machines (see
[`mini-services/conductor-daemon/README.md`](mini-services/conductor-daemon/README.md)
for the reference implementation, registration flow, and session policies).
Daemon and host status is visible via `bun run doctor`, the Runtime Dashboard's
Hosts/Sessions tabs, and `GET /api/hosts`. Running the daemon as an OS service
(systemd/launchd/Windows service) is a manual setup — wrap the `bun index.ts`
start command in your service manager of choice.

## Backup & export

Two independent ways to keep a copy of your data:

**Whole-instance backup (SQLite):** the entire database is a single file.
Locally that's `prisma/dev.db` (or wherever `DATABASE_URL` points). In Docker
it's on the `app_data` volume at `/data/app.db`. Stop the app (or ensure no
writes are in flight) and copy it:

```bash
# local
cp prisma/dev.db backups/dev-$(date +%F).db
# docker
docker compose cp app:/data/app.db ./backups/app-$(date +%F).db
```

Restore by putting the file back (local) or `docker compose cp` it into the
volume and restarting. On PostgreSQL, use `pg_dump` / `pg_restore` instead.
SQLite WAL files (`app.db-wal`, `app.db-shm`) are safe to copy alongside the main
file for a hot backup.

**Per-project export:** `GET /api/projects/<id>/export` (admin session, or a
scoped `read` key bound to the project) returns a versioned JSON bundle with the
project's tasks, chains, agents, modes and runtimes — **never any secrets** (API
keys, key hashes, and runtime `config` blobs are stripped). Re-import it into a
brand-new project with `POST /api/projects/import` (`{ "bundle": … }`), which
mints fresh ids and preserves all internal relationships. Imported agents come
back **keyless and inactive** — rotate a key from the API Keys tab before they
can run again.

```bash
curl -b cookies.txt http://localhost:3000/api/projects/<id>/export > project.json
curl -b cookies.txt -X POST http://localhost:3000/api/projects/import \
  -H 'content-type: application/json' -d "{\"bundle\": $(cat project.json)}"
```

## Upgrading

**Docker:**

```bash
git pull
docker compose up --build          # entrypoint re-runs `prisma db push`
```

**Manual:**

```bash
git pull
bun install
bun run db:push
bun run build
bun run start
```
