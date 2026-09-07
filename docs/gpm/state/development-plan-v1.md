# Development Plan v1 — Conductor → A+ State

> Historical plan. Completed work and original assumptions are retained here.
> The remaining-work order was replanned on 2026-09-07 in
> [the current GPM program](working-program-2026-09-07.md) and
> [root backlog](../../../backlog.md); use those to select the next task.

Generated: 2026-07-03 per `docs/gpm/backlog-builder-v5.1.md`.
Input design: `current-state-evaluation.md` (brownfield report substitutes for a Solution Design per deployment-kit rule).
Target: every evaluation dimension ≥ 8/10 **and** daemon mode executing real work (Assumption A2).

---

## 1. Readiness Decision

Quality gate (BB §5) against the evaluation-as-design: Business Context ✓ (vision + walkthrough), Architecture Overview ✓ (architecture-memory.md), Data Models ✓ (prisma/schema.prisma is authoritative), APIs/Interfaces ✓ (entry-point inventory), User Journeys ✓ (UX journey scan).
**Health Score: Clarity 3 + Feasibility 3 + Completeness 2 = 8/9 → PROCEED.**
(Completeness 2: no cycle-time/usage data; flagged as UNKNOWNs in the evaluation.)

## 2. Critical Gaps (from evaluation — drive EPIC order)

1. Daemon execution layer absent (prompt never reaches spawned CLI) — core promise
2. Engine correctness: double-dispatch race, Model B stranded claims, timeout mismatch
3. Authorization: instance-wide scoped keys; no spend budgets
4. Trust UX: silent failures, invisible cost/dead-letters, no notifications
5. Frontend structure: single-route SPA, prop drilling, unused headline deps, a11y
6. Ops: no app container, no ADRs, stale debt register, lint gate off

## 3. Domain Glossary (enforced from now — P3)

Canonical terms live in `architecture-memory.md` §Glossary. Additions this plan introduces:
- **Runner**: the daemon subcomponent that turns a leased TaskStep into a real OS process (new, EPIC A)
- **Execution Payload**: the composed bundle a daemon receives — systemPrompt, instructions, context, policy (exists in `daemon/steps/next` response; named now)
- **Budget**: per-project spend ceiling in USD; dispatch pauses when exceeded (new, EPIC B)
- **Claim Lease**: liveness-bounded ownership of a Model-B task claim (new, EPIC B)
- **Notification**: in-app/email signal for events needing a human (review gate, dead-letter, budget) (new, EPIC C)
One term per concept: "daemon" = the external worker process; never "agent" for it. "Chain" = a task's step DAG; never "workflow" in code (UI copy may say workflow).

## 4. Assumptions

See `assumptions-ledger.md`. High-impact: A1 (single-operator, single-instance), A2 (A+ definition), A3 (Claude Code headless is first CLI target), A4 (adopt TanStack Query + dnd-kit; remove next-intl + zustand).

## 5. Backlog

**Initial full decomposition: EPICs A and B (BB rule 4). C–G are scoped at story level; expand each after the preceding EPIC's retro (BB §10).**
Sequencing rationale: correctness → trust → structure → features → ops → hardening. EPIC D is deliberately AFTER the frontend refactor (E) so board features aren't built on the structure being replaced; EPIC C contains only localized fixes to keep rework risk low.

---

### EPIC A — Real Daemon Execution (Tracer Bullet)

- **Objective:** A DAEMON-mode step composed by the dispatcher executes as a real CLI process in a workspace directory and its output and evidence land back on the board.
- **Tracer Bullet?:** YES
- **Mode:** PROTOTYPE (per mode.md exception) — TDD required for runner logic, optional for wiring
- **DoD additions:** (1) walkthrough calendar step produces a real file change in a workspace; (2) killed daemon mid-step → step reclaimed and retried within lease rules; (3) no step instruction is ever shell-interpolated (spawn arrays only)
- **Business Value:** converts the headline product promise from aspirational to real (evaluation finding #1). Success metric: docs walkthrough completes with DAEMON agents end to end.
- **Risk:** HIGH — CLI invocation semantics vary per OS. Mitigation: A-0 SPIKE first. | MEDIUM — command injection via templates. Mitigation: spawn with arg arrays, never `sh -c` on user strings (DoD 3).
- **SLO:** Daemon runner — step pickup-to-process-spawn < 5s over any 1h window.
- **Assumptions:** A3 (Claude Code headless first).
- **ADRs to write:** ADR-1 "Runner process model (spawn, stdio, timeouts)".
- **Smoke Test Story:** A-4.
- **Runbook:** `docs/gpm/state/phase-summaries/epic-A-runbook.md` (created in A-4-T2).

**A-0 — SPIKE: Headless CLI invocation contract.** Timebox S. Validate on Windows + WSL: how `claude -p` (and one generic fallback CLI) accepts a long prompt (stdin vs arg vs file), exit codes, streaming stdout, cwd behaviour, auth inheritance. Deliverable: findings note + recommended invocation per platform → unblocks A-1. DoR: READY.

**A-1 — Prompt delivery to the spawned process.**
As the **operator**, I want a leased DAEMON step's Execution Payload actually given to the CLI process, so that the agent works on the task instead of echoing.
AC (Gherkin core):
- Given a daemon with a configured runner and a leased step, When the runner spawns the CLI, Then the process receives systemPrompt + instructions (per A-0's mechanism) and `step.mode` policy as env/flags.
- Given the CLI exits non-zero, When the runner reports completion, Then the step is marked failed with stderr tail attached (feeds existing retry/backoff).
- Given a template referencing unknown tokens, Then registration fails loudly (no silent drop).
Value 3 · Priority 5 · Size M · INVEST ✓ · Idempotency: step lease + attempt id already provide it. DoR: READY (after A-0).
- **A-1-T1** (Hat FEATURE, Tier X): Extend `mini-services/conductor-daemon` runner: build spawn spec from Execution Payload; stdin/arg prompt delivery; capture exit code + stdout/stderr. TDD: failing tests on a fake CLI first. Pull Gate: A-0 findings hold. Unblocks A-1-T2.
- **A-1-T2** (Hat FEATURE, Tier X): Server side — ensure `daemon/steps/next` payload is complete and versioned (add `payloadVersion`); contract test both directions. Contract Snapshot → `snapshots/daemon-execution-payload.md`. Unblocks A-2. END OF STORY.

**A-2 — Workspace working directory.**
As the **operator**, I want the runner to execute in the step's workspace directory, so that file changes land where the project lives.
AC: Given a project with a workspace path known to the daemon, Then the CLI spawns with that cwd; Given no workspace mapping, Then the step fails with a clear `workspace_unmapped` error (never runs in daemon's own cwd); Given a policy `readOnly`, Then the runner refuses write-mode invocation.
Value 3 · Priority 4 · Size M · DoR: READY.
- **A-2-T1** (FEATURE, X): daemon-side workspace registry (config file mapping workspaceId → path) + cwd enforcement + tests. Pull Gate: A-1 payload contract. Unblocks A-3. END OF STORY.

**A-3 — Output & evidence capture.**
As a **reviewer**, I want the runner's stdout streamed as session events and the result stored as step output/artifacts, so the board shows what really happened.
AC: Given a running step, Then session events appear live (existing `daemon/sessions/[id]/events` plumbing); Given completion, Then step output contains the CLI's final output and `git diff --stat` (if repo) as an artifact.
Value 3 · Priority 4 · Size M · DoR: READY.
- **A-3-T1** (FEATURE, X): wire runner stdout → session events (batched), completion → `POST /api/daemon/steps` with output + artifacts; tests with fake CLI. Pull Gate: A-2 cwd semantics. Unblocks A-4. END OF STORY.

**A-4 — E2E smoke: walkthrough step for real.**
As the **stakeholder**, I want one step of the calendar-app walkthrough executed by a real daemon+CLI, so the tracer bullet is proven.
AC: Given the walkthrough project and a live daemon, When the first build step dispatches, Then a file exists in the workspace afterwards and the board shows the step done with evidence. Alt: daemon killed mid-run → step reclaimed after lease expiry (verifies B-3 interim behaviour).
Value 3 · Priority 5 · Size S · DoR: READY.
- **A-4-T1** (FEATURE, X): scripted smoke (extend `scripts/doctor.ts --smoke` with `--daemon-e2e`). Unblocks B-1.
- **A-4-T2** (PREPARATORY, V): runbook + phase summary + Architecture Memory update (Core §4). END OF STORY / END OF EPIC.

---

### EPIC B — Engine Correctness & Safety

- **Objective:** The dispatch engine never double-spends, never strands work, and cannot be driven across project or budget boundaries.
- **Tracer Bullet?:** NO
- **Mode:** DELIVERY (full DoD, TDD mandatory)
- **DoD additions:** (1) race tests prove single dispatch per (step, attempt) under concurrent pollers; (2) a killed Model-B agent's task is re-offerable within 15 min; (3) budget-exceeded projects dispatch nothing until raised.
- **Business Value:** trust in the core; direct cost control. Metric: zero duplicate LLM calls in race test suite; budget enforcement demonstrable.
- **Risk:** MEDIUM — lease refactor touches the hottest path. Mitigation: B-6 test suite lands WITH B-1 (same PR), not after.
- **SLO:** Dispatch — duplicate-dispatch rate = 0 over any window; stranded-claim age p95 < 15 min.
- **ADRs:** ADR-2 "Leasing & idempotency model (steps AND claims)"; ADR-3 "Budget enforcement point".
- **Smoke Test Story:** B-7.
- **Runbook:** epic-B runbook (dead-letter triage, budget-pause recovery).

**B-1 — Lease-first dispatchStep.** (fixes TD-C)
As the **operator**, I want the step lease taken before any expensive async work, so two poll cycles can't both dispatch the same step.
AC: Given a step selected by two concurrent `pollAndDispatch` cycles, Then exactly one proceeds past the lease and the other exits silently; Given the same process re-polling, Then re-taking its own lease no longer permits a second concurrent execution (in-flight set or lease nonce); attempt numbers allocated atomically (unique-constraint retry, not `count()`).
Value 3 · Priority 5 · Size M · DoR: READY.
- **B-1-T1** (REFACTORING, X): move lease to top of `dispatchStep` (src/lib/server/dispatch.ts:62); replace attempt `count()` with atomic allocation; add lease nonce. TDD: the race tests of B-6-T1 written first. Pull Gate: A-4 smoke green. Unblocks B-2. END OF STORY.

**B-2 — Claim Lease + reaper for Model B.** (fixes TD-B; assumption A5)
As an **external agent operator**, I want abandoned task claims released automatically, so a crashed agent doesn't block the queue forever.
AC: Given a claimed IN_PROGRESS task whose agent's `lastSeenAt` exceeds the claim-lease window (default 15 min, configurable), When the reaper sweeps, Then the task returns to BACKLOG with an activity entry and appears in `/api/agent/next` again; Given the agent heartbeats, Then the claim renews.
Value 3 · Priority 4 · Size M · DoR: READY.
- **B-2-T1** (FEATURE, X): schema `Task.claimExpiresAt` (+ migration/rollback), claim on PUT, renew on heartbeat, reaper in scheduler tick; tests incl. renewal race. Unblocks B-3. END OF STORY.

**B-3 — Reconcile daemon-stale vs lease timeout.**
AC: Given a daemon marked stale (30s), Then its leased steps are reclaimed immediately rather than after 10-min lease expiry, with `lease_reclaimed` audit.
Value 2 · Priority 3 · Size S · DoR: READY.
- **B-3-T1** (FEATURE, X): reclaim-on-stale in sweep (`daemon-auth.ts:85-90` → `daemon-dispatch.ts`); tests. Unblocks B-4. END OF STORY.

**B-4 — Project-scoped API keys.** (fixes TD-D; assumption A8 allows the breaking change)
AC: Given a scoped key bound to project P, When `POST /api/tasks` carries projectId Q≠P, Then 403; Given an unbound legacy key, Then it keeps instance-wide behaviour but logs a deprecation warning (migration path).
Value 3 · Priority 4 · Size M · DoR: READY.
- **B-4-T1** (FEATURE, X): schema `ScopedApiKey.projectId?` (+ migration/rollback), enforcement in `authorizeAdminOrScopedKey`, settings-scoped-keys UI selector; tests. Unblocks B-5. END OF STORY.

**B-5 — Close the remaining security gaps.**
AC (three independent Gherkin blocks): HTTP reaction URL passes `isSafeExternalUrl`; workspace-less projects never dispatch to foreign-workspace daemons (require explicit `workspaceId` or fail step with clear error); production boot without `AGENTBOARD_WS_SECRET` fails fast at env validation.
Value 3 · Priority 4 · Size S · DoR: READY.
- **B-5-T1** (FEATURE, X): the three guards + tests (reactions/types/http.ts:7, daemon-dispatch.ts:14-18/155, env.ts:24-25). Unblocks B-6. END OF STORY.

**B-6 — dispatchStep test suite.** (fixes TD-F first half)
AC: mock-adapter suite covers: happy path, adapter error → backoff → dead-letter, fallback-agent escalation, MCP tool loop bounds, concurrent-poller race (with B-1), budget check (with B-7). Coverage of dispatch.ts:62-462 ≥ 80% lines.
Value 3 · Priority 5 · Size L · DoR: READY.
- **B-6-T1** (PREPARATORY, X): fake adapter + registry seams (no behaviour change). Lands before/with B-1.
- **B-6-T2** (FEATURE, X): the suite itself. Unblocks B-7. END OF STORY.

**B-7 — Spend budgets.**
As the **operator**, I want a per-project USD budget that pauses dispatch when exceeded, so agents cannot spend unbounded money.
AC: Given `Project.budgetUsd` set and month-to-date recorded cost ≥ budget, Then `pollAndDispatch` skips the project, a `budget_exceeded` activity + Notification (stub until C) is written, and the board header shows a paused-budget chip; Given budget raised, Then dispatch resumes next tick. Alt: no budget set → unchanged behaviour.
Value 3 · Priority 4 · Size M · Feature flag: `budgets` default ON (new install) / OFF (existing DB until migration reviewed). DoR: READY.
- **B-7-T1** (FEATURE, X): schema + enforcement in step-queue + tests. 
- **B-7-T2** (FEATURE, X): settings General tab budget field + board chip. E2E smoke = EPIC smoke. END OF STORY / END OF EPIC. → Retro, then expand EPIC C.

---

### EPIC C — Trust & Feedback UX (story-level scope; expand after B retro)

Mode DELIVERY. Objective: a user can always tell broken from empty from loading, and events needing a human reach one. ADR-4 "Notification model".
- C-1: Toast + state for the silent catches (task-detail-drawer.tsx:100,133-135; useProjectData.ts:70-85,143) — board shows error state ≠ "No projects yet". (S)
- C-2: Optimistic drag-and-drop with rollback (useTaskManager.ts:218-245). (S)
- C-3: Markdown rendering for description/notes/agent output (4 sites in the drawer). (S)
- C-4: Notification center (in-app) + email opt-in for review-gate-waiting, dead-letter, budget-exceeded; reuse nodemailer reaction transport. (L)
- C-5: Surface on board: dead-letter count chip → panel, per-project month-to-date cost, "no runtime configured" banner, WS indicator on mobile. (M)
- C-6: Loading skeletons for board/drawer/settings lists (replace 27 spinner sites where content-shaped). (M)
- C-7: Landing CTA de-dupe + `/api/chain` copy fix + prod-safe demo seed decision. (S)
Smoke story: kill the API mid-session → user sees error states and a reconnect, never a fake-empty board.

### EPIC D — Product Completeness — EXPANDED 2026-07-03 (ready to execute on the refactored board)

Mode DELIVERY (TDD). Objective: table-stakes task-management features. Now builds on E's context/typed-client/query-free board. ADR-6 "Task filter/query model". Sequencing: D-1 first (establishes the filter state pattern the board + D-3 selection reuse); D-2/D-4 are schema+card work (share the card render — serialize or one agent); D-5/D-6 are server-heavy and parallel-safe with the UI stories; D-7 done already (commit d1e5cfb).
Schema-lane stories (exclusive Prisma access, serialize): D-2, D-6-import. Card-render stories (share board-task-card.tsx, serialize): D-2 badge, D-4 badge, D-1/D-3 selection overlay.

**D-1 — Board search + filters.** As an operator with a busy board, I want to filter tasks by text/agent/priority/tag so I can find work without scrolling.
AC: header search box + filter popover; filters apply client-side over the loaded project (the board already holds all tasks) with a result count; empty-filter state distinct from empty-board (C-1) and error (C-1); filter state lives in a new UiState slice (survives view switches, encodable to URL per E-1's ?filter= later — not required now). No server change (board loads all tasks today; pagination is D-1b if task counts grow). Size M.
- D-1-T1 (FEATURE, X): filter state in board-context UiState + a `useFilteredTasks` selector memoized over tasks+filters; feeds tasksByStatus. Tests: selector filters by each dimension + combinations.
- D-1-T2 (FEATURE, X): search box + filter popover UI (Command/Popover primitives — note ui/command.tsx was deleted in E-8; use Popover + inputs or re-add cmdk only if needed), result count, clear-all. END OF STORY.

**D-2 — Due dates.** As an operator, I want due dates on tasks so scheduling and overdue work are visible.
AC: `Task.dueDate DateTime?` (+ migration/rollback); date picker in TaskDialog; card badge (op-amber soon / op-red overdue); overdue filter integrates with D-1; optional reminder Notification (reuse C-4 notifications.ts) emitted by the scheduler when a task goes overdue (dedupe once per task). Size M. Schema lane + card lane.
- D-2-T1 (FEATURE, X): schema + TaskDialog picker + contracts validation + card badge. Pull Gate: D-1 card render.
- D-2-T2 (FEATURE, X): overdue reminder emit in scheduler tick + Notification; test dedupe + boundary. END OF STORY.

**D-3 — Bulk operations.** As an operator, I want multi-select move/archive/delete with undo so I can clear a board fast.
AC: selection mode toggle; checkbox overlay on cards (keyboard-accessible per E-4 patterns); bulk move-to-status / archive / delete via existing task routes (batch client-side calls or a new batch endpoint — prefer batch endpoint POST /api/tasks/batch to avoid N round-trips; server change); undo via a toast action restoring prior state (reuse soft-delete/restore for delete, status snapshot for move). Size M-L.
- D-3-T1 (FEATURE, X): POST /api/tasks/batch (move/archive/delete, project-scoped auth) + tests.
- D-3-T2 (FEATURE, X): selection UI + bulk action bar + undo toast. Pull Gate: D-1 selection scaffolding. END OF STORY.

**D-4 — Agent pause toggle.** As an operator, I want a one-click pause on an agent so I can stop it dispatching without deleting it, and see paused agents clearly.
AC: `Agent.isActive` already exists — surface a toggle in settings-agents + sidebar agent list; paused agents show a "paused" badge on their card contributions and in the agent list; the dispatcher already skips inactive agents (verify in step-queue) — the fix is visibility, not logic. Size S.
- D-4-T1 (FEATURE, X): toggle + optimistic update + badges; test the PUT path + skip behavior assertion. END OF STORY.

**D-5 — Self-service password reset + email invites.** As an admin, I want to invite users by email and let them reset passwords, so onboarding doesn't require sharing temp passwords in-band.
AC: reuse email-transport.ts (C-4); invite creates the user + emails a one-time set-password link (tokenized, expiring — new PasswordResetToken model, hashed like sessions); reset flow (request → email → set). Env-gated on SMTP (unconfigured falls back to today's shown-temp-password). Size M. Schema lane (token model).
- D-5-T1 (FEATURE, X): token model + issue/consume service (hashed, expiring) + tests.
- D-5-T2 (FEATURE, X): invite + reset API routes + email; AuthView "forgot password" + set-password page. END OF STORY.

**D-6 — Project export / import + backup guidance.** As an operator, I want to export a project (tasks, chains, agents sans secrets) and re-import it, so I can back up and move projects.
AC: GET /api/projects/[id]/export → JSON bundle (no API keys/hashes); POST import creates a new project from a bundle (validate shape, remap ids, never import secrets); INSTALL/README backup section (SQLite file + export). Size M. Schema-read only for export; import is a write path (idempotency: new ids).
- D-6-T1 (FEATURE, X): export route + bundle schema + redaction test (no secret fields present).
- D-6-T2 (FEATURE, X): import route (id remap, validation, no-secret enforcement) + tests. END OF STORY.

**D-7 — DONE** (commit d1e5cfb, with C-7).

### EPIC E — Frontend Architecture Refactor

Mode DELIVERY. Objective: URL-addressable app, one data layer, accessible board. ADR-5 "Frontend data & routing architecture". Assumption A4 governs adopt-vs-remove.
- E-1: Routes for views (board/runtime/skills/help + task deep-links); help page → server-rendered. (L)
- E-2a: typed API client module; migrate the four hooks off raw fetch. (M) ✅ DONE (c0a1c33)
- E-2b: TanStack Query adoption for reads + mutations. **DEFERRED (2026-07-03, owner decision).** Rationale: after E-2a (typed client) + E-3 (grouped contexts), the remaining payoff — cache-invalidation discipline — is largely covered, while the cost is a rewrite of the central `currentProject` state that every mutation and WS event updates, partly duplicating the WS reconciliation that already works. Not worth the risk now. Tracked as TD-023; revisit only if manual cache management becomes a demonstrated pain. (XL)
- E-3: Project context/store kills BoardView prop drilling (110 → <15 props). (L)
- E-4: dnd-kit with KeyboardSensor replaces native DnD; cards keyboard-reachable (role, tabIndex, Enter opens drawer). (M)
- E-5: Memoization pass: memoized cards/columns; liveAgentLogs isolated from board re-render. (M)
- E-6: Settings IA: 12 flat tabs → 4 groups; native confirm()/alert() → AlertDialog everywhere. (M)
- E-7: Mobile authoring nav (sidebar actions reachable below md). (M)
- E-8: Remove next-intl + zustand (or adopt per A4 decision at refinement); token-drift cleanup (raw hex → op-*). (S)

### EPIC F — Ops, Debt & Governance

Mode DELIVERY→HARDENING. Objective: turnkey deploy, honest debt register, enforced gates.
- F-1: Dockerfile(s) + compose for app + board-ws + optional PG; healthchecks; one-command up. (L)
- F-2: Cross-platform scripts (start without POSIX-isms) + INSTALL rewrite. (S)
- F-3: ADR backfill: ADR-1..5 above + SQLite/PG duality, 3-plane auth, poll dispatch, single-instance constraint (+ runtime guard: refuse second scheduler on same DB). (M)
- F-4: Lint re-enable core rules + `any` burn-down to <30; reactStrictMode on. (M)
- F-5: TECHNICAL_DEBT.md re-baseline from this plan's TD items; wire into retro cadence. (S)
- F-6: SLOs defined + measured (dispatch latency, WS delivery), board-ws health consumed by doctor; incident runbooks. (M)

### EPIC G — Hardening & 1.0

Mode HARDENING. Objective: releasable 1.0.
- G-1: Playwright e2e smoke pack (first-run, task lifecycle, chain with human gate, daemon e2e). (L)
- G-2: A11y audit pass (focus traps in hand-built overlays, aria on board, contrast). (M)
- G-3: Security re-review (reviewer-identity binding on sign-offs, legacy plaintext key purge, rate limiter). (M)
- G-4: Performance: 500-task board budget (<16ms interaction), scheduler load test. (M)
- G-5: Docs/site final pass + version 1.0 + NEXT EVALUATION re-run (target: all dims ≥8). (S)

---

## 6. Validator Summary (BB §9)

- Structure: DAG ✓ (A→B linear; C,E parallel-eligible after B; D after E). EPIC 1 = tracer bullet ✓. Every task has Unblocks + Pull Gate (A/B explicit; C–G at expansion) ✓. Token budgets: all tasks ≤15k est. ✓
- Quality: stories DoR-checked (A/B READY; C–G HOLD-until-expansion by design) ✓. Hats declared ✓. TDD order stated where DELIVERY ✓. Two Hats: B-1 pure REFACTORING? — no: B-1-T1 changes behaviour under race, declared REFACTORING for structure with B-6 tests first; accepted with note. Glossary consistent ✓.
- Testing: critical paths → B-6 suite + per-story tests; external integration (Anthropic adapter) has fake-adapter contract seam (B-6-T1); schema changes carry migration + rollback + flag (B-2, B-4, B-7, D-2) ✓. E2E smoke per EPIC ✓.
- Risk & Debt: risks ≥ Medium mitigated inline ✓; every shortcut → TD item in re-baselined register (F-5) ✓. Assumptions Ledger present ✓.
- Operations: SLOs on A, B, F ✓ (C–E inherit at expansion); runbooks per EPIC ✓; feature flags on user-facing schema changes ✓; idempotency: leases + attempt keys + claim leases ✓.
- Economics: no task spec exceeds its expected output (anti-bureaucracy) ✓; C–G deliberately not over-decomposed ✓.

**Next action:** execute A-0 (SPIKE), then A-1-T1. After EPIC A: phase summary + Architecture Memory update + retro, then expand EPIC B stories that changed.
