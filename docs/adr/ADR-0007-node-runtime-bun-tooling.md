# ADR-0007: Node runtime for the app; Bun for tooling

Status: Accepted

Date: 2026-07-10

## Context

Conductor is developed with Bun (fast installs, native TS, `bun test`). But the
default turnkey database is a single SQLite file via `@prisma/adapter-better-sqlite3`
(ADR-0004), and **better-sqlite3's native addon cannot load under Bun**
(oven-sh/bun#4290 — `ERR_DLOPEN_FAILED`). Any process that opens the database
therefore cannot run under Bun on the default install. This bit three things:

- the **app server** — the Next.js instrumentation hook queries the DB at boot,
  so `bun <server>` crashes on startup (observed in `server.log`, 2026-07-04);
- the **doctor** diagnostic — `bun scripts/doctor.ts` failed its own DB check
  with a raw dlopen error, so the self-check could never pass (gap 0.2);
- any **script** that imports `src/lib/db`.

Meanwhile the README advertised "Bun 1.3+", implying a Bun-run server. The
self-contradiction ("a Bun project that must not run under Bun") blocked an
honest install story.

## Decision

**Split the runtime by job.**

- **Node runs everything that touches the database**: the production server
  (`.next/standalone/server.js` via `scripts/start.mjs`), the dev server
  (`next dev` spawns Node), and the `doctor` / `smoke-test` diagnostics — which
  now run through **`tsx`** (a Node-based TS runner that honors the `@/*`
  tsconfig paths; Node's native `--experimental-strip-types` does not resolve
  the path alias, so a bare Node entry is insufficient). Node 20+ is required;
  22.x is what we develop against.
- **Bun remains the tooling runtime**: `bun install`, `bun test` (the unit suite
  mocks the DB, so it never loads better-sqlite3), `bun run <script>`, and
  driving `next build`. `bun run doctor` is a thin delegator — the script body
  runs under Node via `tsx`.
- **One Bun-only exception**: `smoke:daemon` (`--daemon-e2e`) spawns its fixture
  via `Bun.spawn`, so it runs under Bun. It carries a guard that names the
  requirement if invoked under Node. (Porting its spawn to `node:child_process`
  is a future option if daemon-e2e must run under Node.)

## Consequences

- `bun run doctor` passes on the default SQLite install (10 checks, DB reachable).
- The install docs say what is true: develop with Bun, the **server runs under
  Node**; the production target is Linux (the Windows standalone build is broken
  by a Turbopack `:`-in-filename issue — dev-only on Windows via `bun run dev`).
- `tsx` is a new devDependency. Justified: it is the minimal way to run the
  DB-touching TS scripts under Node without a build step.
- This ADR does not change the DB duality (ADR-0004) or the runner model
  (ADR-0001); it only pins which interpreter runs which process.

## Alternatives considered

- **Bun + Postgres everywhere** (drop SQLite so the better-sqlite3 issue never
  arises). Rejected: it destroys the zero-infrastructure turnkey default that
  ADR-0004 exists to protect.
- **Node with `--experimental-strip-types`, no tsx.** Rejected: it does not
  resolve the `@/*` path alias or extensionless imports the codebase uses, so
  the doctor's import graph fails to load.
- **Wait for Bun to support better-sqlite3.** Rejected: an upstream dependency
  with no timeline cannot gate an honest 1.0 install story.
