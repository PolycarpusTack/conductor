# Epic S7 — Automation Rules Engine (Design)

**Status: design doc — no implementation this round.**

**Goal (from the settings-completion roadmap):** a rules engine on top of the
scheduler: auto-assign by tag/priority/title, auto-archive DONE tasks, review-gate
escalation, retry-policy defaults.

## What already exists (verified 2026-06-05)

The pieces of a rules engine are mostly built — they just only point *outward*:

| Piece | Where | What it does today |
|---|---|---|
| Event bus | `fireProjectEvent` (project-event.ts) | broadcasts + fires triggers for `chain-completed`, `step-failed`, `task-created`, `step-reviewed` |
| Condition grammar | `TriggerFilter` (triggers/evaluator.ts) | `field` (dot-path into payload) × `equals/not_equals/contains/not_contains/matches(regex)` |
| Action pipeline | `Reaction` model + `reactions/executor.ts` | ordered, per-action enable/disable, `consecutiveFailures`/`lastError` tracking, mustache templating |
| Action types | reactions/types/ | **outbound only**: `post:slack`, `post:http`, `create:jira`, `send:email` |
| Time base | scheduler.ts global check interval | per-project polling with weekly schedule windows |
| Lazy sweeps | retention.ts (fired from activity GET) | log/artifact/deleted-task purges |
| Retry defaults | Epic S4 | per-mode `maxAttempts` already feeds step `maxRetries` |

**Core design decision: automation rules are *internal reactions* — new reaction
types that mutate Conductor state instead of posting to external services. We reuse
the Trigger (event + filters) and Reaction (ordered actions + failure tracking)
machinery, its CRUD routes, and most of the Integrations UI rather than building a
parallel `AutomationRule` model.** A separate model would duplicate the filter
grammar, the executor's error handling, and the entire settings surface for no
behavioral gain.

## New reaction types (Phase 1 — event-driven rules)

All live in a new `src/lib/server/reactions/internal.ts`, registered in the
executor's type registry next to the outbound ones. Each one logs an
`automation_rule_fired` activity row (component `automation`) with the trigger
name, action, and affected entity.

| Type | Config | Behavior |
|---|---|---|
| `task:assign` | `{ agentId }` or `{ agentRole }` | sets `task.agentId` (role resolves to the project's first matching agent); skips if already assigned unless `force: true` |
| `task:set-priority` | `{ priority }` | bumps/sets priority |
| `task:set-retry` | `{ maxRetries, retryDelayMs? }` | updates the task's **pending** steps only (running/done attempts keep their history) |
| `task:archive` | `{}` | sets `task.archivedAt` (see below) |
| `step:escalate` | `{ bumpPriority?, reassignFallback?, notifyTriggerId? }` | priority bump and/or swap in the step's `fallbackAgentId`; outbound notification stays a *separate* reaction on the same trigger — composition, not duplication |

Example rules these enable, with zero new UI concepts:

- *Auto-assign by tag*: trigger on `task-created` + filter `tag equals backend` →
  `task:assign {agentRole: "developer"}`.
- *Auto-assign by title*: filter `title matches ^\[bug\]` → `task:assign`.
- *Flaky-area retry policy*: filter `tag equals flaky` → `task:set-retry {maxRetries: 5}`.
  (Per-mode defaults already shipped in S4 — this covers per-*rule* overrides.)
- *Failure escalation*: trigger on `step-failed` + filter `attempt equals maxRetries`
  → `step:escalate` + `post:slack` as the second reaction on the same trigger.

### Payload requirements

`task-created` currently broadcasts the full board task — filters on `tag`,
`priority`, `title`, `agentId` work as-is. `step-failed` payloads must add
`attempt`/`maxRetries`/`mode` (small dispatch change). Document the filterable
fields per event in the Integrations UI helper text.

## Archive semantics

There is no `ARCHIVED` status and soft-delete (S3) is the wrong tool — `deletedAt`
feeds a 30-day purge. Archive must be non-destructive:

- New `Task.archivedAt DateTime?` + `@@index([projectId, archivedAt])`.
- Board queries add `archivedAt: null`; an "Archived" view (Activity-tab sibling of
  Deleted) lists and restores them. No purge — archived means *kept, out of the way*.
- `task:archive` only fires on DONE tasks; an automation must never archive live work.

## Time-based rules (Phase 2)

Two of the roadmap's rules are clock-driven, not event-driven:

- *Auto-archive DONE after N days*
- *Review-gate escalation: human step idle > N hours*

Rather than a cron, emit **synthetic events from a sweep** hooked into the
scheduler's existing global check interval (scheduler.ts already ticks per-project;
the sweep runs at most once per hour per project, guarded by a `lastAutomationSweepAt`
timestamp on Project):

- sweep finds DONE tasks older than the project's `autoArchiveDays` → fires
  `task-stale` events through `fireProjectEvent` → normal trigger/filter/reaction flow.
- sweep finds human-gate steps `WAITING` longer than `reviewEscalationHours` → fires
  `review-gate-stale` events likewise.

This keeps *all* rule evaluation in one engine — the sweep only manufactures events.
`TRIGGERABLE` grows `task-stale` and `review-gate-stale`; `triggerEventTypes` in
contracts.ts grows the same two values.

## Safety rails (non-negotiable, Phase 1)

1. **No cascades.** Internal actions mutate state via `db` directly and do NOT call
   `fireProjectEvent` — an automation can never trigger another automation. If a
   genuine need appears later, add explicit opt-in with a depth-1 cap; default stays off.
2. **Idempotence.** Every internal action no-ops cleanly when the target is already
   in the desired state (assigned, archived, right priority) so re-fired events are harmless.
3. **Failure isolation.** The executor's existing `consecutiveFailures` auto-disable
   (and `lastError` surfacing in the Integrations tab) applies unchanged to internal types.
4. **Audit.** Every fired rule writes an activity row; the Activity tab's existing
   filters make automation behavior inspectable. A `dryRun` flag on Reaction (logs
   what *would* happen) ships with Phase 1 — debugging rules without one is misery.

## UI (Phase 3)

- Integrations tab: reaction type picker grows an "Internal actions" group with
  per-type config forms (agent picker, priority select, retry numbers). Trigger-side
  needs nothing new.
- Automation tab: add the two sweep settings (`autoArchiveDays`,
  `reviewEscalationHours`, both nullable = off) next to the scheduler controls, plus
  a read-only "recent automation activity" list filtered from the activity log.
- Help: rewrite the Settings · Automation section; the recipes above become a
  TryIt box each.

## Out of scope

- Cross-project / workspace-level rules.
- A visual rule builder beyond the existing filter editor.
- Scheduled *task creation* (recurring tasks) — adjacent feature, separate design.
- LLM-evaluated conditions ("assign if the description sounds urgent").

## Phasing & estimates

| Phase | Scope | Size |
|---|---|---|
| 1 | internal reaction types + safety rails + payload enrichment + dryRun | ~2 sessions |
| 2 | `archivedAt` + sweep + synthetic events + Archived view | ~1–2 sessions |
| 3 | Integrations/Automation UI + help | ~1 session |

Phase 1 is independently shippable: event-driven auto-assign, retry overrides, and
failure escalation deliver most of the user value with the smallest schema change
(none beyond the dryRun column).
