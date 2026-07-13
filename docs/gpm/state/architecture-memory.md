# ARCHITECTURE MEMORY: Conductor (AgentBoard)

Updated: 2026-07-13 (post EPICs G0+G1 — see phase-summaries/phase-summary-epic-G1.md)

## Components

- **Web app (Next.js 16, Bun)**: single monolith; App Router used for API only — UI is a one-route client SPA (`src/app/page.tsx` view-switcher) — stable, needs restructuring
- **API layer (`src/app/api/**`)**: thin handlers over `src/lib/server/**`; three auth planes (admin/user session cookie, agent API keys SHA-256-hashed, daemon tokens + scoped keys) — stable
- **Dispatch engine (`src/lib/server/dispatch.ts`, `step-queue.ts`, `scheduler.ts`)**: per-project 10s poll → lease-FIRST → execute → advanceChain; DAG chains, retries + backoff, dead-letter table, review gates; atomic attempt allocation; budget-paused projects skipped (`budget.ts`) — stable, 94.7% covered
- **HTTP adapter path (`src/lib/server/adapters/anthropic.ts`)**: real LLM calls, 10-round tool loop, token accounting, cost recorded on StepExecution (estimate fallback TD-020) — WORKS end to end
- **Daemon path (`mini-services/conductor-daemon`)**: REAL EXECUTION at ENGINE PARITY (EPIC G1) — runner.ts spawns claude/template CLI shell-less with stdin prompt in the workspace cwd (workspace.ts, deny-by-default policy), streams batched session events (streaming.ts), attaches git evidence (evidence.ts). Payload v2 is server-resolved (prompts, previousOutput, rejectionNote, layered modeInstructions, sanitized MCP servers via `--mcp-config` + env-indirection secrets); completion/failure route through the shared Finalizer in dispatch.ts (ADR-0008: server-authoritative retry, dead-letter+notify, fallback), StepExecution rows + cost bind budgets, maxConcurrent enforced at lease. Gap: e2e smoke (G1-1-T5) skipped — pre-existing run-loop issue, needs a Linux host session
- **Pull-claim API (Model B, `/api/agent/*`, `/api/cli`)**: claims carry a renewable 15-min lease (Task.claimExpiresAt); claim-reaper.ts (60s tick) returns expired claims to BACKLOG; stale daemons release step leases in ~30s
- **Realtime (`mini-services/board-ws`)**: Socket.IO service; app pushes via authed internal /broadcast; silently disabled if WS secret unset
- **Persistence (Prisma)**: SQLite default / Postgres+pgvector optional; embeddings as String cast via raw SQL on PG; schema provider hardcoded sqlite — fragile duality
- **Frontend**: App Router route group `src/app/(board)/` (board/runtime/skills client pages + server-rendered /help) over a shared `board-shell.tsx` that runs the four hooks once and packages them into six memoized contexts (`board-context.tsx`); components are prop-less context consumers; typed API client (`src/lib/api/`); dnd-kit keyboard-accessible board with memoized cards; mobile authoring via slide-over Sheet. next-intl/zustand removed; react-query installed-but-unused (deferred, TD-023)

## Key ADRs (current) — docs/adr/

- ADR-0001 Runner process model (daemon spawns CLI: arg-arrays, stdin prompt, NDJSON, cwd enforcement)
- ADR-0002 Leasing & idempotency (steps AND claims: lease-first, attempt key, reaper, stale reclaim)
- ADR-0003 Budget enforcement point (month-to-date StepExecution.cost gates dispatch; binds BOTH paths since G1-1-T4)
- ADR-0004 SQLite/Postgres/pgvector duality (provider hardcoded sqlite, runtime adapter swap, embeddings via raw SQL)
- ADR-0005 Three-plane auth (sessions / agent keys / daemon+scoped keys; CSRF + SSRF guards)
- ADR-0006 Poll-based single-instance dispatch (in-process scheduler + SchedulerLock guard)
- ADR-0007 Node runs the app/tests, Bun is tooling (better-sqlite3 refuses Bun)
- ADR-0008 Server-authoritative daemon retry (Finalizer owns retry/dead-letter/fallback; daemon willRetry = hint)

## Domain Glossary (initial, extracted from code)

- **Project**: tenant-like container for tasks, agents, chains; optional workspace
- **Task**: kanban card (BACKLOG/IN_PROGRESS/WAITING/REVIEW/DONE); may carry workflow steps; dueDate + overdue reminders (D-2); soft-delete/archive; bulk ops via /api/tasks/batch (D-3); board filter by text/agent/priority/tag/overdue (D-1)
- **TaskStep**: one node of a task's chain DAG; leased, retried, dead-lettered
- **Chain**: ordered/DAG sequence of TaskSteps across agents; advanceChain/rewindChain
- **Agent**: a configured AI worker (system prompt, runtime, invocationMode HTTP|DAEMON|human)
- **Runtime**: provider/model binding for an agent (e.g. Anthropic model)
- **Daemon**: external worker process that leases DAEMON-mode steps (protocol only today)
- **Workspace / Host**: where daemon work is meant to run (model exists; execution absent)
- **Review gate**: human sign-off step; requiredSignOffs, superseded approvals
- **Skill**: reusable capability doc; semantic search on PG+pgvector, text fallback otherwise

## Integration Map

- Web app → Anthropic API: sync HTTPS (tool loop)
- Web app → board-ws: sync HTTP POST /broadcast (Bearer secret) → Socket.IO fan-out
- Daemon → Web app: HTTP poll (register/heartbeat/next/complete)
- Scheduler → dispatch: in-process setInterval per project (single-instance only)

## Active Technical Debt (top — full register in TECHNICAL_DEBT.md)

- ~~TD-A..D~~ (EPICs A+B) · ~~TD-E~~ (EPIC E) · ~~TD-F~~ (EPIC F) · ~~TD-018b + TD-025~~ (EPIC G1, 2026-07-13: daemon StepExecution/budgets + dead-letter parity) · ~~TD-014b~~ (2026-07-13: deterministic suite) — RESOLVED
- TD-024: Docker images never actually built (no Docker on dev host) — verify on a Docker host before prod (EPIC G2, blocked on A12)
- G1-1-T5 daemon e2e smoke skipped: pre-existing run-loop issue (step served, never completed) — needs a Linux-host session; parity work is unit-verified

## Current Mode: DELIVERY (see mode.md)
