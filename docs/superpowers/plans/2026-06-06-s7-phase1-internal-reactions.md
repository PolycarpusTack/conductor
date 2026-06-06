# S7 Phase 1 — Internal Reaction Types + Safety Rails

Per the design doc (`2026-06-05-settings-s7-automation-rules-design.md`): automation
rules are internal reaction types on the existing Trigger/Reaction pipeline. This
phase ships the engine; the scheduler sweep (Phase 2) and dedicated UI forms
(Phase 3) come later. The Integrations tab's generic JSON config textarea means the
new types are usable immediately once they appear in the type picker.

**Verified against codebase 2026-06-06:**
- `dispatchReaction` (reactions/executor.ts:21) is a plain switch — internal types
  slot in; it needs a context param (projectId/taskId) which outbound types ignore.
- Reaction CRUD spreads `parsed.data` — adding `dryRun` to the contract flows through.
- dispatch.ts already emits step-failed via `fireProjectEvent` (aliased import);
  the exhausted-retries payload has `attempt`/`exhaustedRetries` but no `mode`/`maxRetries`.
- `TaskStep.status` default is `"pending"` — `task:set-retry` targets pending only.
- No `archivedAt` exists; board GET filters `deletedAt: null` (tasks/route.ts:26).

## Task 1 — Schema + contracts + internal executors (TDD)

- [x] Schema: `Reaction.dryRun Boolean @default(false)`; `Task.archivedAt DateTime?`
  + `@@index([projectId, archivedAt])`. Push + generate.
- [x] Contracts: `reactionTypeSchema` += `task:assign`, `task:set-priority`,
  `task:set-retry`, `task:archive`, `step:escalate`; `createReactionSchema` += `dryRun`.
- [x] `reactions/internal.ts`: the five executors, each (a) idempotent — clean
  `{skipped}` output when the target is already in the desired state, (b) writing an
  `automation_rule_fired` activity row (component `automation`) on real mutations,
  (c) mutating via `db` directly — NEVER `fireProjectEvent` (no cascades).
- [x] Tests (`internal-reactions.test.ts`): assign happy/skip-if-assigned/role
  resolution/project-scope guard, set-priority idempotence, set-retry pending-only,
  archive requires DONE, escalate priority-bump ladder + fallback reassign.

## Task 2 — Executor wiring + payload enrichment + archive surfaces

- [x] `executeReactions` passes `{projectId, taskId}` context to `dispatchReaction`;
  `reaction.dryRun` short-circuits BEFORE dispatch for ALL types with output
  `{dryRun: true, wouldExecute: type, config}` (and still updates lastFiredAt).
- [x] dispatch.ts: exhausted-retries step-failed payload += `mode`, `maxRetries`;
  failStep payload += `mode`.
- [x] Board/task queries also exclude archived: tasks GET, project include,
  agent/next, agent/tasks, cli (mirror every `deletedAt: null` site).
- [x] Archive surfaces mirroring deleted-tasks: `GET api/projects/[id]/archived-tasks`,
  `POST api/tasks/[id]/unarchive`.
- [x] Tests: dryRun short-circuit, step-failed payload fields, archived-tasks routes.

## Task 3 — UI exposure + help + wrap-up

- [x] settings-integrations.tsx: REACTION_TYPES grows an internal-actions group
  (labels prefixed "⚙ Internal:"), config placeholder hints per type, dryRun checkbox
  on the new-reaction form.
- [x] Help: Settings · Automation section gains the shipped Phase 1 reality + recipe
  examples; roadmap callout updated to "Phase 1 shipped, sweep + UI forms next".
- [x] Mark S7 roadmap entry "Phase 1 shipped"; full verification; commits per task.

> **Implemented 2026-06-06.** Deviations: dryRun short-circuits in
> `executeReactions` before dispatch (uniform across all types) rather than
> per-executor; reaction rows got a `dry` toggle + badge and the new-reaction
> form a checkbox; type picker prefills per-type starter configs (CONFIG_HINTS).
> Tests live in reaction-executor.test.ts (single import site for the executor +
> internal module keeps the bun mock.module registry coherent); archive route
> tests live in deleted-tasks.test.ts. The step-failed payload enrichment is
> exercised indirectly (dispatch tests) rather than asserted field-by-field.
