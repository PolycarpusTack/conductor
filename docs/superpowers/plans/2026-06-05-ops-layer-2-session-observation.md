# Ops Layer Epic 2: Session Observation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daemon execution sessions observable. A daemon reports the local sessions it runs (pty/tmux/process); admins see them per host, per task, and in a Sessions tab — status, command, working dir, and a bounded output tail. **Observation only: the browser can never send input to a session** (design hard rule; interactive control is explicitly out of scope).

**Architecture:** `AgentSession` rows are owned by daemons — identity always derives from the daemon token, never the payload (same pattern as `/api/daemon/events`, which also provides the workspace-scoping check for task links). A session service handles upsert, event application (status transitions, output-tail accumulation with secret redaction), and broadcasts `session-status` / `session-output` project events through the existing board-ws relay. Storage keeps only a redacted ~5KB preview tail (roadmap decision D3). Admin reads via `GET /api/sessions` (filterable by workspace/task/status) and the Epic-1 host detail's `sessions` placeholder. UI: Sessions tab in the Runtime Dashboard (polling, like Hosts) and an execution-session section in the task detail drawer.

**Context (verified against current code):** daemon auth via `extractDaemonToken`/`resolveDaemonByToken` (returns `{id, workspaceId, hostname, status, hostId}`); workspace scoping precedent in `src/app/api/daemon/events/route.ts`; broadcast via `broadcastProjectEvent(projectId, event, payload)` in `src/lib/server/realtime.ts` (needs a projectId — sessions without one skip broadcast); `Daemon.sessionCapabilities` and host detail `sessions: []` placeholders exist from Epic 1.

**Tech Stack:** Prisma 7, Next.js 16 App Router, TypeScript 5, Zod 4, Bun test

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - Output events on a non-terminal session also flip its status to `active` (output implies liveness); terminal statuses stay sticky as planned.
> - The task drawer got an "Execution Sessions" *section* (renders only when sessions exist) rather than a tab — the drawer has no tab system and one wasn't worth introducing for a single panel; the design's Messages/Evidence tabs can drive that refactor when they land.
> - `redactSecrets` masks bearer tokens, structured app keys (`cd_daemon.*`/`ab_agent.*`/`ab_project.*`), `sk-*` keys, and secret-looking `KEY=value` pairs — pattern list is deliberately conservative and lives in one place for extension.
> - Broadcasts are emitted server-side (`session-status`/`session-output`); the dashboard polls (10s) like the Hosts tab. Socket wiring into the UI rides along with Epic 3 as planned.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | New `AgentSession` model (+ Host relation) |
| `src/lib/server/daemon-contracts.ts` | `upsertSessionSchema`, `sessionEventSchema` (discriminated union) |
| `src/lib/server/agent-sessions.ts` | New — upsert, event application, output-tail bounding, secret redaction |
| `src/app/api/daemon/sessions/route.ts` | New — POST upsert (daemon token) |
| `src/app/api/daemon/sessions/[sessionId]/events/route.ts` | New — POST events (daemon token, ownership check) |
| `src/app/api/sessions/route.ts` | New — GET list, filters: workspaceId/taskId/status (admin or scoped read) |
| `src/app/api/hosts/[id]/route.ts` | Fill the `sessions` placeholder |
| `src/components/session-list.tsx` | New — session rows (status, backend, command, output tail) |
| `src/components/runtime-dashboard.tsx` | Sessions tab |
| `src/components/task-detail-drawer.tsx` | Execution sessions section |
| `src/lib/server/__tests__/agent-sessions.test.ts` | New — service unit tests |
| `src/lib/server/__tests__/daemon-sessions-route.test.ts` | New — route auth/ownership tests |

---

### Task 1: Schema — AgentSession

- [x] **Step 1:** Add to `prisma/schema.prisma` (after `Host`):

```prisma
model AgentSession {
  id             String    @id @default(cuid())
  workspaceId    String
  projectId      String?
  agentId        String?
  daemonId       String
  hostId         String?
  taskId         String?
  stepId         String?
  sessionKey     String    // daemon-local stable name
  backend        String    // pty | tmux | process | container
  cwd            String?
  command        String?   // summary only, never raw input streams
  status         String    @default("starting") // starting | active | idle | waiting | exited | failed
  lastActivityAt DateTime?
  startedAt      DateTime  @default(now())
  endedAt        DateTime?
  exitCode       Int?
  outputPreview  String?   // redacted, bounded tail (~5KB)
  metadata       String?   // JSON

  host Host? @relation(fields: [hostId], references: [id], onDelete: SetNull)

  @@unique([daemonId, sessionKey])
  @@index([workspaceId, status])
  @@index([projectId, agentId])
  @@index([taskId, stepId])
}
```
plus `sessions AgentSession[]` on `Host`. Note `daemonId` is required (sessions are daemon-owned) but intentionally NOT a relation — sessions outlive daemon re-registration the same way dead-letters outlive tasks.

- [x] **Step 2:** `db:push` + `generate`; type-check; commit.

---

### Task 2: Contracts + session service (TDD)

- [x] **Step 1:** Zod in `daemon-contracts.ts`:
  - `upsertSessionSchema`: `{ sessionKey (1..120), backend enum, cwd?, command? (≤500), agentId?, projectId?, taskId?, stepId?, status? enum, metadata? }`
  - `sessionEventSchema` discriminated union:
    - `{ type: 'status', status: 'active'|'idle'|'waiting'|'exited'|'failed', reason?, exitCode? }`
    - `{ type: 'output', stream: 'stdout'|'stderr', chunk: string (≤8000), truncated? }`
    - `{ type: 'command', commandSummary: string (≤500) }`
    - `{ type: 'metric', cpuPct?, memoryMb? }`
- [x] **Step 2:** Failing tests for `src/lib/server/agent-sessions.ts`:
  - `appendOutputPreview(existing, chunk)` keeps only the LAST `MAX_OUTPUT_PREVIEW_CHARS` (5000)
  - `redactSecrets(text)` masks bearer tokens, `sk-…`/`cd_daemon.…`/`ab_agent.…` style keys, and `KEY=value` pairs for names matching /(secret|token|password|api_?key)/i
  - `applySessionEvent(session, event)` → status event sets status (+ `endedAt`/`exitCode` for exited/failed); output event appends redacted tail + bumps `lastActivityAt`; command event sets `command`; metric event merges into `metadata`
  - terminal statuses (`exited`/`failed`) are sticky — later `output` events don't resurrect `status`
- [x] **Step 3:** Implement; tests green; commit.

---

### Task 3: Daemon session routes

- [x] **Step 1:** `POST /api/daemon/sessions` — daemon token required. Upsert by `(daemon.id, sessionKey)`; `workspaceId`/`hostId` always from the resolved daemon, never the payload. If `taskId` present, verify the task's workspace matches the daemon's (events-route precedent) and derive `projectId` from the task. Broadcast `session-status` when projectId known. Returns `{ sessionId }`.
- [x] **Step 2:** `POST /api/daemon/sessions/[sessionId]/events` — daemon token; 403 unless `session.daemonId === daemon.id`; parse event; `applySessionEvent`; persist; broadcast `session-output` (bounded redacted chunk) or `session-status`.
- [x] **Step 3:** Route tests (mock `daemon-auth` full surface + db): 401 missing/invalid token, 403 foreign session, 404 unknown session, 400 malformed event, 200 upsert + status flow.
- [x] **Step 4:** Commit.

---

### Task 4: Admin read APIs

- [x] **Step 1:** `GET /api/sessions?workspaceId&taskId&status&limit` — `requireAdminOrScopedKey(request, 'read')`; newest-first by `lastActivityAt`.
- [x] **Step 2:** Fill host detail `sessions` (last 20, newest first).
- [x] **Step 3:** Endpoint auth tests (401/200/filters).
- [x] **Step 4:** Commit.

---

### Task 5: UI — Sessions tab + task drawer section

- [x] **Step 1:** `src/components/session-list.tsx` — reusable list: status badge (starting/active/idle/waiting/exited/failed), backend chip, sessionKey, command, cwd, relative last activity, expandable output preview (`<pre>` tail). Self-fetching panel variant with polling for the dashboard.
- [x] **Step 2:** `Sessions` tab in Runtime Dashboard.
- [x] **Step 3:** Task detail drawer: "Execution sessions" section (renders only when the task has sessions) fetching `/api/sessions?taskId=`.
- [x] **Step 4:** Type-check/lint/tests; commit.

---

### Task 6: Wrap-up

- [x] **Step 1:** Full verification; mark checkboxes; deviations note.
- [x] **Step 2:** Commit.

## Out of scope (Epic 3+)

- Dispatch integration (`steps/next` session policy, `StepExecution.sessionId`) — Epic 3.
- Interactive input of any kind — never in this epic, per design.
- Live socket UI updates for sessions (broadcasts are emitted; dashboard polls like the Hosts tab — socket wiring can ride along with Epic 3's daemon reference implementation).
- Durable session replay (`SessionEvent` table) — explicitly rejected for v1 (roadmap D3).
