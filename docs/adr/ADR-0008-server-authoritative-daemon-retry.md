# ADR-0008: Server-authoritative daemon retry & the shared Finalizer

Status: Accepted

Date: 2026-07-11

## Context

Conductor executes steps two ways (ADR-0001): the HTTP path, where the server
runs the adapter inside `executeDispatch`, and the DAEMON path, where an external
daemon runs a CLI and POSTs the result to `/api/daemon/steps`. The two paths had
drifted badly on failure handling:

- **The daemon decided its own retries.** The route trusted a `willRetry` boolean
  in the daemon's report. But the reference daemon (`conductor-daemon/index.ts`)
  hardcodes `willRetry: false`, so **every daemon failure was single-attempt and
  terminal** — the step's own `maxRetries`/`retryDelayMs` were ignored.
- **Daemon terminal failures were invisible.** The route marked the step `failed`
  but never called `moveToDeadLetter` or `notifyDeadLetter` (TD-025), so exhausted
  daemon steps appeared in neither the dead-letter panel nor the notification bell.
- **No fallback-agent escalation** on the daemon path.

The attempt-closing logic (retry ladder, backoff, fallback, dead-letter, notify,
task-status resolution) lived inline in `executeDispatch`. Duplicating it into the
daemon route would have been the second full copy.

## Decision

- **Extract a shared Finalizer** (G1-1-T1). `finalizeStepSuccess` and
  `finalizeStepFailure` are exported from `dispatch.ts` and own attempt closing
  for both paths. `executionId` is nullable (the daemon has no `StepExecution`
  row until G1-1-T4) and an `eventMeta` bag carries path-specific event fields
  (the daemon's `source`/`daemonId`). The HTTP path's behaviour is unchanged.
- **The server is authoritative on retry** (G1-1-T2). The daemon route computes
  `attemptNumber = step.attempts + 1` and calls `finalizeStepFailure`, which
  decides retry-vs-terminal from the step's own `maxRetries` exactly as the HTTP
  path does. The daemon's `willRetry` is **demoted to a logged hint** — recorded
  in the `daemon-step-failed` dashboard event and the finalize log line, never
  obeyed.
- **Parity on exhaustion.** A terminal daemon failure now dead-letters, notifies,
  and (if configured) escalates to the fallback agent — identical to HTTP. This
  closes TD-025.

## Consequences

- A daemon step with `maxRetries: 2` now genuinely gets 3 attempts under server
  backoff, regardless of what the daemon reports.
- Every exhausted daemon step is visible in the dead-letter panel and the bell.
- The daemon protocol is unchanged on the wire (it still sends `willRetry`); only
  the server's interpretation changed, so old daemons keep working.
- Cost/budget binding for daemon attempts (TD-018b) is a **separate** step
  (G1-1-T4): it adds the `StepExecution` row the Finalizer will finalize. Until
  then the daemon passes `executionId: null` and the execution-log write is
  skipped — failure handling is already at parity; only the accounting row is
  pending.
- This ADR refines ADR-0003 (budget enforcement point): once T4 lands, daemon
  spend records on `StepExecution` like HTTP, so the budget gate binds for
  DAEMON-only projects.

## Alternatives considered

- **Keep `willRetry` authoritative, fix the reference daemon to send `true`.**
  Rejected: it leaves every third-party/older daemon able to opt out of retries
  and dead-lettering by omission, and keeps the retry policy split across the wire.
- **A second copy of the retry/dead-letter logic in the route.** Rejected: Rule
  of Three (same bounded context) — extract at the second occurrence.
