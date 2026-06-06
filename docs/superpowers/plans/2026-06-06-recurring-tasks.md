# Recurring Tasks

The feature the S7 design explicitly deferred: scheduled *task creation*. It
composes the pieces already shipped — a recurrence is "instantiate task template
X (S6) on a cadence", run from the scheduler's global tick with the same
atomic-claim pattern as the S7 sweep.

**Verified against codebase 2026-06-06:**
- Task templates carry titlePattern/description/priority/tag/notes + an attached
  chain template; chain steps store `agentRole`, which the UI never resolves —
  `taskStepSchema` strips it, and steps without agents never dispatch
  (step-queue requires `agent.runtimeId`). The runner must resolve roles itself.
- Tasks POST sets chain tasks IN_PROGRESS + `startChain`; parity for recurrences.
- S4 mode `maxAttempts` feeds step `maxRetries` in both creation routes — the
  runner keeps that semantic.
- The scheduler tick already calls `runAutomationSweeps()`; the recurrence
  runner slots in beside it.

## Task 1 — Model + cadence math + runner (TDD)

- [ ] `RecurringTask` model: name, projectId (Cascade), taskTemplateId (Cascade —
  a recurrence dies with its template), `cadence` (daily | weekly | monthly),
  `dayOfWeek Int?` (0–6, weekly), `dayOfMonth Int?` (1–28, monthly),
  `timeOfDay String` ("HH:MM"), enabled, lastRunAt?, nextRunAt (claim column),
  timestamps. `@@index([enabled, nextRunAt])`.
- [ ] `recurring-tasks.ts`: pure `computeNextRunAt(cadence, opts, from)` (always
  strictly in the future) + `runRecurringTasks()` — due rows claimed via
  updateMany (nextRunAt rolled forward + lastRunAt stamped), then instantiate:
  title from titlePattern with `{date}` → YYYY-MM-DD (fallback "name — date"),
  template fields, chain steps with `agentRole` resolved to the project's first
  matching agent, per-mode maxAttempts default, IN_PROGRESS + `startChain` when
  steps exist else BACKLOG, `task-created` fired (composes with S7 auto-assign
  rules), `recurring_task_created` activity row.
- [ ] Tests: cadence math (daily rollover, weekly day pick, monthly clamp,
  always-future), claim race no-op, instantiation (template fields, role
  resolution, event + audit), disabled rows ignored.

## Task 2 — CRUD routes + scheduler hook

- [ ] Contracts: `createRecurringTaskSchema` (name, taskTemplateId, cadence,
  dayOfWeek/dayOfMonth/timeOfDay with cross-field refinement), update partial.
- [ ] Routes `api/projects/[id]/recurring-tasks` (GET/POST) +
  `[recurringId]` (PUT/DELETE), template-in-project validation, nextRunAt
  computed server-side on create/update.
- [ ] scheduler tick: `runRecurringTasks().catch(...)` beside the sweep.
- [ ] Route tests: create computes nextRunAt, cross-project template rejected,
  PUT recomputes when cadence fields change.

## Task 3 — UI + help + wrap-up

- [ ] Automation tab "Recurring Tasks" block: list (name, cadence summary, next
  run, enabled switch, delete) + add form (name, task-template select fetched
  from the S6 endpoint, cadence/day/time inputs). Empty state points at the
  Templates tab.
- [ ] Help: Automation section gains a Recurring Tasks subsection; roadmap note.
- [ ] Full verification; commits per task.
