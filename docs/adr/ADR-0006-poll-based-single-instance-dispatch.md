# ADR-0006: Poll-based single-instance dispatch

Status: Accepted

Date: 2026-07-04

## Context

Dispatch is driven by an in-process scheduler, not an external queue. On
startup, `src/instrumentation.ts` calls `initializeScheduler`
(`src/lib/server/scheduler.ts`), which starts a per-project `setInterval`
poller (default 10s) plus a 60s global tick that runs the scheduled-window
check, automation sweeps, recurring tasks, the claim reaper, and overdue
reminders. Poller state lives in a module-level `Map<projectId, ...>` — one
copy per Node process — and dispatch stamps a per-process `WORKER_ID`
(`src/lib/server/dispatch.ts`) onto every lease.

This model assumes **a single app instance per database** (Assumption A1:
single-operator, single-instance). Two app instances against the same DB would
each run their own pollers and both select the same unleased steps. The leasing
model (ADR-0002) makes that *safe* — exactly one dispatch per (step, attempt)
still holds, because the DB lease and the `(stepId, attempt)` unique constraint
are the real mutual exclusion — but it is **wasteful and racy**: both instances
pay for the expensive prelude (memory build, embeddings, MCP resolution) before
one of them loses the lease, and both run redundant global sweeps. There is no
leader election, so horizontal scaling / HA is not supported today.

Before F-3 nothing *enforced* the single-instance assumption; a second instance
would quietly start dispatching.

## Decision

Keep the poll-based, single-instance, in-process scheduler — it is the right
fit for the single-operator target and avoids an external broker dependency —
but add a **coarse advisory "scheduler owner" lock** so only one instance
dispatches at a time.

Design (`src/lib/server/scheduler-lock.ts`, wired into
`scheduler.ts:initializeScheduler`):

- A singleton lock row (`id = "singleton"`) carries `ownerId` (a per-process
  scheduler owner id, analogous to dispatch's `WORKER_ID`) and `heartbeatAt`.
- On init, `startSchedulerOwnership` calls `tryAcquire`: a guarded `updateMany`
  claims the row if it is unowned, already ours, or the current holder's
  heartbeat is older than the TTL; if no row exists yet it races to `create`
  one (unique id → exactly one creator wins; the loser reads P2002 and stands
  by). This is the same guarded-write idiom as `leaseStep`.
- The winner starts the pollers and refreshes the lock on a heartbeat interval
  (`refresh` = `updateMany` guarded on `ownerId` still being ours).
- A losing instance does **not** start its pollers, logs the clear warning
  *"another scheduler instance owns dispatch; this instance will not dispatch"*,
  and keeps retrying on the heartbeat interval. If the owner dies and its
  heartbeat goes stale past the TTL, a standby instance's next `tryAcquire`
  succeeds and it takes over (starts its pollers). If a live owner ever loses
  the lock (its guarded `refresh` returns 0 rows), it relinquishes — stops its
  pollers.
- TTL is a small multiple of the heartbeat (default heartbeat 60s, TTL 180s) so
  takeover happens within a few minutes of an instance dying, without flapping.

### Schema

The lock is a singleton `SchedulerLock` model (no existing table fit —
`AdminConfig` is a fixed-schema auth singleton and there is no generic key-value
table):

```prisma
model SchedulerLock {
  id          String   @id @default("singleton")
  ownerId     String
  heartbeatAt DateTime
  acquiredAt  DateTime @default(now())
}
```

The guard reaches the delegate through a narrow structural interface in
`scheduler-lock.ts` (kept minimal so the store mocks trivially in tests). It
still **fails open** defensively: if the lock store is ever unavailable it logs
one warning and starts the pollers as before — correctness is unchanged because
the leases (ADR-0002) remain the real mutual exclusion; only the
waste-avoidance is lost.

## Consequences

- A second instance against the same DB refuses to dispatch and cleanly takes
  over only if the primary dies — no double prelude cost, no duplicate global
  sweeps.
- This is **not** HA/leader election in the strong sense: takeover is
  TTL-bounded (minutes), and the losing instance does no dispatch work at all
  (it is a cold standby, not a load-sharing peer). Real horizontal scaling would
  need an external queue and is out of scope for the single-operator target.
- The guard logic is unit-tested against a mocked DB
  (`src/lib/server/__tests__/scheduler-lock.test.ts`): first instance acquires,
  second is blocked while the first is live, a standby takes over after TTL
  expiry, a live owner relinquishes when it loses the lock, and the fail-open
  path starts dispatch when the lock table is absent.
</content>
