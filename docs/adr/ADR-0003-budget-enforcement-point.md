# ADR-0003: Budget enforcement point

Status: Accepted

Date: 2026-07-04

## Context

Agents spend real money on every LLM call. A per-project USD ceiling has to
pause dispatch when exceeded, and the pause has to happen at a single, obvious
place — enforcing it inside each adapter would be duplicated and easy to bypass,
while enforcing it too late (after the LLM call) would defeat the purpose. We
also need a single source of truth for "how much has this project spent this
month" that agrees with the usage analytics the UI already shows.

## Decision

**Enforcement point: `pollAndDispatch`, before routing any step.**
`src/lib/server/step-queue.ts` collects the distinct project ids of all
dispatchable steps for the tick and calls
`filterBudgetPausedProjects(projectIds)` (`src/lib/server/budget.ts`). Steps
belonging to a paused project are removed from the batch **before** the
HTTP/daemon routing `Promise.allSettled`. Skipped steps stay `active` and
unleased, so dispatch resumes automatically on the first tick after the budget
is raised or the UTC month rolls over.

**Source of truth: `StepExecution.cost`.** `getMonthToDateSpend`
(`budget.ts`) sums `StepExecution.cost` over the current UTC calendar month
(`startedAt >= monthStartUtc`) — the same field and window the runtimes/usage
rollup uses. On the HTTP path, `dispatch.ts` records this cost after a
successful execution, preferring the adapter-reported figure and falling back
to a model-rate estimate (`estimateCost`) when the adapter reports tokens but
no cost. Unknown models estimate to 0 and are recorded as null, never a fake
zero.

**Feature flag by nullability.** `Project.budgetUsd` is nullable; null IS the
flag. Projects without a budget are filtered out at the first query
(`budgetUsd: { not: null }`) and behave exactly as before — the spend query is
never even run for them.

**Pause episodes, not per-tick spam.** The most recent `budget_exceeded` /
`budget_lifted` activity row marks the episode. A pause writes `budget_exceeded`
+ a Notification once; the first under-budget tick after a pause writes
`budget_lifted`. A broken budget check fails open for that tick (logged) so it
can never take the dispatcher down.

## Consequences

- The budget gate is centralized and provider-agnostic: no adapter can dispatch
  around it, and adding a provider needs no budget code.
- Enforcement is coarse (per-tick, ~10s granularity) and advisory-after-the-
  fact: a step already in flight is not killed, and month-to-date spend lags by
  the currently-running steps. Acceptable for a spend ceiling, not a hard cap.
- **Known gap (TD-018): DAEMON-mode is blind to budget.** Daemon runs do not
  yet create `StepExecution` rows (see ADR-0001), so their cost never enters
  `getMonthToDateSpend`. Budgets and cost accounting therefore bind only for
  HTTP agents today. The claude runner already parses `total_cost_usd`
  (`runner.ts`); wiring it into a `StepExecution` row is the fix and is tracked
  as remaining TD-018 work.
- Reconciling on the UTC month boundary keeps the window definition identical to
  the usage analytics, so the board's cost figures and the pause decision never
  disagree.
</content>
