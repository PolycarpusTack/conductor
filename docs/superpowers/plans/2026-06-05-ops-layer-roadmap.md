# Operations Layer — Implementation Roadmap

> Breaks the design in `docs/superpowers/specs/2026-04-29-ai-maestro-inspired-ops-layer-design.md`
> into sequenced, individually-shippable epics. Each epic gets its own executable plan doc
> (`2026-06-05-ops-layer-<n>-<name>.md`) written when the epic starts, so plans reflect the
> codebase as it actually is at that moment — the stale-plan problem from the 2026-04-29 batch
> taught us that lesson.

**Status:** ✅ COMPLETE — all 7 epics implemented and released (Epics 1–3 → v0.1.0, Epics 4–7 → v0.2.0, both 2026-06-05). Each epic's plan doc carries its implementation notes and deviations.
**Baseline:** v0.0.6 (2026-06-05) → **Delivered:** v0.2.0 (2026-06-05)

---

## Phase 0 status: ✅ COMPLETE (as of v0.0.6)

Every prerequisite in the design doc is already satisfied — and several capabilities the design
assumed it would have to build now exist:

| Design prerequisite / assumption | Status |
|---|---|
| `type-check` failures fixed | ✅ green |
| Prompt library + wizard behind admin auth | ✅ done (faa9410) + endpoint auth tests (b79d2c3) |
| Lint/test/type-check/build green in CI | ✅ 252 tests, ordered GH Actions workflow |
| Prisma regenerate discipline | ✅ postinstall hook + CI stale-client detection |
| **Bonus groundwork the design predates:** | |
| Step event log (`StepEvent`) | ✅ evidence packets can reference it directly |
| Dead-letter queue + requeue UI | ✅ ops surface already exists |
| W3C trace context on steps + daemon handoff | ✅ sessions inherit the same pattern |
| Scoped API keys (`ApiKey` read/write) | ✅ integration auth model in place |
| `/api/health` + per-runtime ping | ✅ doctor command builds on these |
| CSRF + env validation | ✅ new admin routes follow the same pattern |

---

## Epic sequencing

Order matters: each epic builds on the previous one's schema and APIs.

### Epic 1 — Host Presence *(plan drafted: `2026-06-05-ops-layer-1-host-presence.md`)*
`Host` model; daemon register/heartbeat upsert host; host list/detail APIs; Hosts tab in
Runtime Dashboard; backfill one Host per existing Daemon. **No sessions yet.**
*Touches:* `prisma/schema.prisma`, `daemon-auth.ts`, `/api/daemon/register|heartbeat`,
new `/api/hosts`, `runtime-dashboard.tsx`.

### Epic 2 — Session Observation
`AgentSession` model; daemon session upsert + event APIs (`POST /api/daemon/sessions`,
`POST /api/daemon/sessions/[id]/events`); realtime `session-status` / `session-output`
events through board-ws; Sessions tab; Execution tab in task drawer. Observation only —
**the browser can never type into a session** (design's hard rule).
*Storage policy:* `outputPreview` tail (2–5 KB, redacted) only; no full stream persistence.

### Epic 3 — Terminal-Backed Step Execution
Session policy parser for runtime config (`sessionPolicy`: ephemeral / persistent-agent /
persistent-task / persistent-step; `sessionBackend`: pty / tmux / process); extend
`GET /api/daemon/steps/next` with the session block; `POST /api/daemon/steps` accepts
`sessionId`; link `StepExecution` ↔ `AgentSession`; daemon **reference implementation**
(see decision D6). Ownership tests: a daemon may only report sessions it owns.

### Epic 4 — Content Safety *(pulled ahead of messaging — messaging depends on it)*
`src/lib/server/content-safety.ts`: `scanForPromptInjection()` + `wrapExternalContent()`
with trust levels (system/admin/agent/external/unknown). Apply to trigger payloads,
webhook-created tasks, and untrusted MCP tool results. Safety metadata stored alongside
content; warning badges in artifact viewer and trigger test output.
*Note:* the design lists this as Capability 5 but messaging (its Capability 4) consumes it,
so it ships first. Small epic — one module + call sites + tests.

### Epic 5 — Agent Messaging
`AgentAddress` + `AgentMessage` models; agent-key send/read/mark-read APIs; admin
project/task message endpoints; Messages tab in task drawer; inbox counts + realtime
events; content safety applied to messages from unverified senders. Messages are
**project-scoped** (decision D2) and **do not advance chains in v1** — `wait_message`
step mode and message triggers are a v1.1 follow-up.

### Epic 6 — Evidence Packets
Assemble per-execution evidence (session, messages, memory/skill hits, MCP tool calls,
artifacts, safety flags, **step events** — now available from v0.0.6); store as
`StepExecution.evidence` JSON in v1; `GET .../evidence` API; Evidence tab in task drawer;
optional review-gate "evidence required" display. This is the differentiator epic.

### Epic 7 — Installer & Doctor
`agentboard doctor` (extends `/api/health` checks: DB, env, prisma client, admin password,
WS secrets, daemon registration, runtime configured, pty capability), `daemon
install/start/status`, `smoke-test`; CI dry-run installer tests. Builds directly on the
v0.0.6 health module.

---

## Open questions — resolved

| # | Question (from design doc) | Decision |
|---|---|---|
| D1 | Host identity stable across hostname changes? | **Yes.** Daemon generates and persists an installation ID (UUID in its config dir); `Host.slug` defaults to it, falls back to normalized hostname for legacy daemons. |
| D2 | Messages workspace- or project-scoped? | **Project-scoped** in v1, per the design's own recommendation. |
| D3 | Persist session output beyond preview? | **No.** Preview tail only; durable results belong in executions/artifacts/evidence. Revisit only with a concrete replay need. |
| D4 | Interactive terminal control? | **Not in v1, not in v1.1 by default.** If ever added: separate design doc, admin-only, audited, require-idle gate, workspace kill-switch. |
| D5 | Materialize `AgentPresence`? | **Derive** from heartbeat + sessions + leases. Materialize only if the derived query becomes a hot path. |
| D6 | Daemon reference implementation location? | **In-repo** at `mini-services/conductor-daemon/` (same pattern as `board-ws`): TypeScript, bun-runnable, implements register/heartbeat/poll/sessions against the documented contract. Keeps contract and consumer in lockstep. |

---

## Cross-cutting rules (apply to every epic)

- **Auth boundaries table from the design is law:** admin session for UI reads, daemon token
  for worker-originated writes, agent key for agent-originated messages. New admin mutation
  routes get `assertSameOrigin`; integration-friendly reads may use `requireAdminOrScopedKey`.
- Schema changes: additive, `db push` + regenerate, backfill scripts in `scripts/`.
- Every epic lands with unit + route tests in the established bun style (full-surface module
  mocks; never module-mock something that has real unit tests).
- Realtime events carry the standard scope envelope (`workspaceId/projectId/taskId/agentId/daemonId/hostId`).
- Each epic = one plan doc, executed, checkboxes marked, deviations noted, committed in
  logical chunks, version bumped at meaningful milestones (suggest v0.1.0 when Epics 1–3
  land: that's the "live operations" story).
