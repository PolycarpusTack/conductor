# Architecture memory: Conductor (AgentBoard)

Updated 2026-09-07 after H-1/H-2 execution; mode DELIVERY. This is current
context, not release certification. [Program](working-program-2026-09-07.md) ·
[Backlog](../../../backlog.md) · [Evidence baseline](current-state-review-2026-09-07.md).

## Components and contracts (verified in source)

- **Web/API:** Next.js 16 under Node; routed board/runtime/skills/help in
  `src/app/(board)/`, shared board shell/context, typed API client and dnd-kit.
  Bun runs tests/tooling; doctor runs Node via tsx. `package.json` is authoritative.
- **Engine:** `dispatch.ts`, `step-queue.ts`, `scheduler.ts` implement polling,
  leases, DAG/linear chains, human gates, retries, fallback, dead-letter and budgets.
  Board status changes do not consistently control active execution. Budget gates
  use recorded spend, not a guaranteed hard cap on in-flight cost.
- **Daemon:** shell-less Claude/template/echo runners; workspace cwd, streamed
  events and artifacts. Payload v2 carries resolved prompts, previous output,
  rejection feedback and MCP server configuration. Attempts/cost/failure policy
  are recorded server-side. Per-tool MCP restrictions do not reach the runner;
  the latest full daemon smoke remains unproven.
- **Pull agents:** `/api/agent/*` and `/api/cli`; renewable task-claim leases and
  reaper. Heartbeat currently writes `isActive=true`, conflating presence and intent.
- **Auth:** named owner/admin/member sessions, agent keys, daemon tokens and scoped
  integration keys. `requireAdminSession` accepts any signed-in role; privileged
  operations need `requireRole`. Key-management coverage is incomplete.
- **Persistence:** Prisma schema is SQLite-pinned; optional PG/pgvector adapter and
  raw-query paths exist. No committed migrations; container boot accepts data loss.
- **Knowledge:** agent memory and attached workspace-scoped skills reach prompts;
  skills CRUD and embedding-on-save exist. Skill version history is not implemented.
- **Integrations:** HTTP MCP lacks initialization/session/auth support. Reactions
  run inline without a durable outbox; later reactions may consume earlier output.
- **Realtime:** authenticated Socket.IO sidecar; finite reconnect and no connect-time
  state resync. Workspace selection currently scopes skills, not project navigation.

## Glossary and integration map

Project contains Tasks/Agents. TaskStep is a Chain node. Agent is configured work
behavior; Runtime binds provider/model. Invocation enum: HTTP or DAEMON; `human`
is a step mode. Daemon is the worker process; Runner spawns a CLI. Workspace is a
database container, distinct from filesystem cwd. Review gate is human sign-off.

Board → API → database/scheduler → HTTP adapter or daemon; daemon → API by polling
and completion; API → board-ws → browser events. Integrations call external services.

## Decisions, debt, and evidence

ADRs 0001–0008 cover runner, leases, budget, providers, auth, scheduler, runtime and
retry; 0010 covers skill consumption. [ADR directory](../../adr/README.md).
No new migration/lifecycle/tool-policy ADR has been accepted by this planning pass.

July G0/G1/G3-1/G3-2 implementations are retained. TD-018b/025 remain implemented;
TD-024 deployment proof and G1-1-T5 smoke remain open. H-1 proved the observed Bun
package-resolution failure depends on the managed sandbox; it was not TD-014b.
Full debt: [register](../../../TECHNICAL_DEBT.md).

H-1/H-2 accepted local evidence: 925 tests pass across 94 files; types pass;
lint 0 errors/4 existing warnings; actual offline fixture doctor 9 pass/1 expected
no-runtimes warning/0 failures. New CI runner uses Node 22.x/Bun 1.3.13, a fresh
checkout, isolated credentials and an owned disposable SQLite database. `verify`
includes packaged build. Whole-app coverage, hosted CI/build, live health and
production SLO achievement remain unverified. Next: **H-3-T1 daemon diagnosis**.
Contracts: [verification](snapshots/verification-entrypoints.md),
[isolation](snapshots/test-isolation.md); [evidence](evidence/H-2-verification.md).
