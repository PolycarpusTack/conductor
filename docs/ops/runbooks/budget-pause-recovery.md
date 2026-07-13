# Runbook — Budget pause recovery

**Symptoms.** A project's steps stop dispatching and you see a `budget_exceeded`
activity row / a `budget-exceeded` toast / `[budget]` warn log:
`project … paused: month-to-date spend $X >= budget $Y`. Steps stay `active` and
**unleased** — they resume on their own once under budget; nothing is lost.

Relevant SLO context: this is expected safety behavior, not an SLO breach. See
[../slos.md](../slos.md).

## How it works (so you don't over-react)

- `Project.budgetUsd` (nullable) is the feature flag. **No budget set ⇒ never
  paused** — the spend query is never even reached.
- Each poll tick, `filterBudgetPausedProjects` sums **month-to-date**
  `StepExecution.cost` (started-at ≥ start of the current **UTC** month) and
  skips the whole project when `spent >= budget`.
- Activity is **one row per pause episode**: a `budget_exceeded` with no later
  `budget_lifted` means "still paused." The first under-budget tick writes
  `budget_lifted` and dispatch resumes automatically.

## Checks

```bash
curl -s "localhost:3000/api/activity?projectId=<id>&search=budget" | jq
# most-recent budget_exceeded (no budget_lifted after) = currently paused
```

1. **Confirm it's really the budget** (not a stall): the latest budget activity
   row is `budget_exceeded`, and the `[budget]` log shows `spent >= budget`. If
   there's no budget row, this is not a budget pause → [dispatch-stalled.md](dispatch-stalled.md).
2. **Check the numbers.** `details` on the activity row carries `budgetUsd` and
   `spentUsd`. Sanity-check against the runtimes/usage analytics (same
   `StepExecution.cost` source of truth).
3. **DAEMON spend counts too** (since G1-1-T4, 2026-07-13 — TD-018b resolved).
   Daemon runs record `StepExecution` rows with cost lifted from the claude
   run-metadata artifact, so daemon-heavy projects pause on budget like any
   other. Caveat: only the **claude runner** reports cost; generic/template
   runner steps record a row but no cost (nothing to lift), so a
   template-runner-only project still under-counts.

## Resolution (pick one)

- **Intended spend** → raise `Project.budgetUsd` in project settings. Next tick
  writes `budget_lifted` and dispatch resumes; no restart needed.
- **Wait for reset** → the window is the **UTC calendar month**. At 00:00 UTC on
  the 1st, month-to-date resets to 0 and the project resumes automatically.
- **Runaway cost was real** → keep it paused, investigate which agent/step
  burned the budget (usage analytics), fix the loop, then raise the budget.

After lifting: confirm a `budget_lifted` row appears and steps start leasing
again within one poll interval (default 10 s).

## Escalation

If spend is under budget but the project stays paused (no `budget_lifted`, steps
still skipped), or `spentUsd` looks wildly wrong vs analytics, capture the
`[budget]` logs and the last few budget activity rows and escalate to the
engine/cost owner — suspects are the estimate-vs-true-cost gap (TD-020) or a
poller not running at all ([dispatch-stalled.md](dispatch-stalled.md)).
