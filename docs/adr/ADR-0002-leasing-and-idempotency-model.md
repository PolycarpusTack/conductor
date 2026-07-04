# ADR-0002: Leasing & idempotency model (steps AND claims)

Status: Accepted

Date: 2026-07-04

## Context

Conductor drives work two ways, and both can double-spend money or strand work
if left unguarded:

- **Push (chain dispatch, "Model A").** A per-project poller
  (`pollAndDispatch`, `src/lib/server/step-queue.ts`) selects active steps and
  dispatches them. Two overlapping poll cycles — or two app instances — can
  select the same still-unleased step. The expensive prelude (memory build,
  embeddings, MCP resolution) can outlast the poll interval, so a naive design
  pays for the prelude twice and issues two LLM calls for one step.
- **Pull (external agents, "Model B").** An external agent claims a task via
  `/api/agent/*`. If that agent crashes mid-task, the claim would block the
  task forever.

The engine must guarantee **exactly one dispatch per (step, attempt)** and must
release ownership that an owner can no longer prove it holds.

## Decision

**Steps — lease-first dispatch with atomic attempt allocation.**

- `dispatchStep` (`src/lib/server/dispatch.ts`) takes the lease FIRST, before
  loading the step or running the prelude. `leaseStep` is a single
  `updateMany` guarded on `status: 'active'` and `leasedBy IN (null, self, or a
  holder whose leasedAt is older than LEASE_TIMEOUT_MS)`. The `where` clause is
  the mutual exclusion; the loser's `updateMany` matches zero rows and it exits
  silently.
- Because `leaseStep` deliberately lets a process re-take **its own** lease
  (that is how a live worker retries), the DB lease alone cannot stop the SAME
  process from dispatching a step twice under overlapping polls. An in-process
  `inFlightSteps` Set is the re-entry guard — re-entry returns immediately
  (`dispatch.ts`).
- Attempt numbers are allocated by inserting against the `(stepId, attempt)`
  unique constraint and advancing on a P2002 conflict (`allocateExecution`),
  **never** from a racy `count()`. The lease provides exclusion; this loop only
  guarantees a fresh, correct attempt number.
- `LEASE_TIMEOUT_MS` (10 min, `step-queue.ts`) is the single shared threshold.
  Both the HTTP path (`dispatch.ts`) and the daemon path
  (`daemon-dispatch.ts`) steal a lease older than this, so a crashed
  worker/daemon's step becomes re-dispatchable. Lease steals are audited as
  `lease_reclaimed` activity rows.

**Claims — claim leases + reaper for Model B.**

- A claimed task carries a renewable liveness bound, `Task.claimExpiresAt`
  (`prisma/schema.prisma`), set on claim/start and renewed by agent heartbeats.
  Dispatcher-driven tasks never set it, which is exactly how the reaper tells a
  reapable Model-B claim from a chain-dispatch `IN_PROGRESS` task.
- `reapExpiredClaims` (`src/lib/server/claim-reaper.ts`, 60s tick) returns
  tasks whose `claimExpiresAt` has passed to `BACKLOG` with a
  `task_claim_reaped` activity entry, skipping tasks whose chain steps are
  still in flight. The write is guarded on the claim still being expired, so a
  heartbeat landing between the sweep's read and write wins the race
  (count 0 → not reaped).

**Stale-daemon reclaim (bridges the two).**

- `markStaleDaemons` (`src/lib/server/daemon-auth.ts`, ~30s) flips a daemon that
  stopped heartbeating to `stale` and immediately calls
  `reclaimStaleDaemonLeases` (`daemon-dispatch.ts`) to release its step leases
  NOW, rather than waiting out the full `LEASE_TIMEOUT_MS`. Each release is
  guarded on `leasedBy` still pointing at the stale daemon and audited as
  `lease_reclaimed`.

## Consequences

- Duplicate-dispatch rate is 0 under concurrent pollers within one process
  (lease + in-flight guard) and across processes (lease + unique attempt key).
  The race suite (`__tests__/dispatch-race.test.ts`) exercises this.
- Attempt allocation is correct even when two staggered dispatchers race on a
  newly-expired lease: the unique constraint forces distinct attempt numbers,
  and only the lease holder proceeds.
- A crashed external agent's task is re-offerable within the claim window
  (default 15 min); a crashed daemon's step within ~30s (stale sweep) rather
  than 10 min (lease timeout).
- Every ownership transfer is auditable (`lease_reclaimed`,
  `task_claim_reaped`).
- The guarantees hold **per DB, single app instance** — the leases make a
  second instance *safe* but wasteful (it would pay for preludes it then loses).
  That constraint, and the runtime guard against it, is ADR-0006.
</content>
