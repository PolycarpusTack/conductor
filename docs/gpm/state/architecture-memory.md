# ARCHITECTURE MEMORY: Conductor (AgentBoard)

Updated: 2026-07-03 (post EPICs A+B — see phase-summaries/phase-summary-epics-A-B.md)

## Components

- **Web app (Next.js 16, Bun)**: single monolith; App Router used for API only — UI is a one-route client SPA (`src/app/page.tsx` view-switcher) — stable, needs restructuring
- **API layer (`src/app/api/**`)**: thin handlers over `src/lib/server/**`; three auth planes (admin/user session cookie, agent API keys SHA-256-hashed, daemon tokens + scoped keys) — stable
- **Dispatch engine (`src/lib/server/dispatch.ts`, `step-queue.ts`, `scheduler.ts`)**: per-project 10s poll → lease-FIRST → execute → advanceChain; DAG chains, retries + backoff, dead-letter table, review gates; atomic attempt allocation; budget-paused projects skipped (`budget.ts`) — stable, 94.7% covered
- **HTTP adapter path (`src/lib/server/adapters/anthropic.ts`)**: real LLM calls, 10-round tool loop, token accounting, cost recorded on StepExecution (estimate fallback TD-020) — WORKS end to end
- **Daemon path (`mini-services/conductor-daemon`)**: REAL EXECUTION — runner.ts spawns claude/template CLI shell-less with stdin prompt in the workspace cwd (workspace.ts, deny-by-default policy), streams batched session events (streaming.ts), attaches git evidence (evidence.ts); gated by `bun run smoke:daemon` (13-check e2e). Gap: daemon runs create no StepExecution rows → budgets/cost bind only for HTTP agents (TD-018); daemon failures never dead-letter
- **Pull-claim API (Model B, `/api/agent/*`, `/api/cli`)**: claims carry a renewable 15-min lease (Task.claimExpiresAt); claim-reaper.ts (60s tick) returns expired claims to BACKLOG; stale daemons release step leases in ~30s
- **Realtime (`mini-services/board-ws`)**: Socket.IO service; app pushes via authed internal /broadcast; silently disabled if WS secret unset
- **Persistence (Prisma)**: SQLite default / Postgres+pgvector optional; embeddings as String cast via raw SQL on PG; schema provider hardcoded sqlite — fragile duality
- **Frontend**: App Router route group `src/app/(board)/` (board/runtime/skills client pages + server-rendered /help) over a shared `board-shell.tsx` that runs the four hooks once and packages them into six memoized contexts (`board-context.tsx`); components are prop-less context consumers; typed API client (`src/lib/api/`); dnd-kit keyboard-accessible board with memoized cards; mobile authoring via slide-over Sheet. next-intl/zustand removed; react-query installed-but-unused (deferred, TD-023)

## Key ADRs (current)

None recorded. (Finding: ADR coverage ABSENT — decisions like SQLite/PG duality, three-plane auth, poll-based dispatch, WS mini-service split are undocumented tribal knowledge.)

## Domain Glossary (initial, extracted from code)

- **Project**: tenant-like container for tasks, agents, chains; optional workspace
- **Task**: kanban card (BACKLOG/IN_PROGRESS/WAITING/REVIEW/DONE); may carry workflow steps
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

- ~~TD-A daemon execution~~ ~~TD-B claim reaper~~ ~~TD-C dispatch race~~ ~~TD-D key scoping~~ — RESOLVED (EPICs A+B, 2026-07-03)
- ~~TD-E frontend stack drift~~ — RESOLVED (EPIC E, 2026-07-03: routing, contexts, typed client, dnd-kit a11y, memoization, dep cleanup)
- TD-F-remainder: no Dockerfile; ESLint rules mostly off — EPIC F
- TD-018-remainder: daemon runs create no StepExecution rows (budgets/cost blind for DAEMON agents); daemon failures never dead-letter
- ADR-1..3 (runner model, leasing/idempotency, budget enforcement point) promised by the plan, not yet written

## Current Mode: DELIVERY (see mode.md)
