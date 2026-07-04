# Service-Level Objectives (SLOs)

Status: **initial baseline (F-6, 2026-07-04).** These formalize the per-EPIC
targets that were named informally during EPICs A/B into
`Service – Metric < Threshold over Window` form.

**Honesty note.** AgentBoard is not yet wired to a metrics backend. OTel spans
are *created* (`src/lib/server/telemetry.ts`, `@vercel/otel` in
`src/instrumentation.ts`) but exported only when `OTEL_EXPORTER_OTLP_ENDPOINT`
is set — unset by default, so nothing aggregates them. Several SLOs below are
therefore **enforced structurally** (DB constraints, reaper sweeps) rather than
**metered**. Each SLO states its true measurement status. Do not read a listed
threshold as "currently alerted on" unless the row says so.

Signals available today:
- **Step events** — `appendStepEvent` writes timestamped rows (`leased`,
  `started`, `succeeded`, `failed`, `retry_scheduled`, `lease_reclaimed`);
  read via `GET /api/tasks/{taskId}/steps/{stepId}/evidence`.
- **Activity log** — `db.activityLog` rows (`lease_reclaimed`,
  `task_claim_reaped`, `budget_exceeded`, `budget_lifted`, …).
- **Structured logs** — `getLogger(tag)` JSON lines in prod (stdout/stderr).
- **`bun run doctor`** — synchronous checks incl. `stranded-work` (SLO-3) and
  `realtime-service` /healthz (SLO-4).
- **`bun run doctor --daemon-e2e`** — end-to-end tracer bullet (records the
  full step wall-clock, not a component breakdown).

---

## SLO-1 — Daemon step pickup-to-spawn latency

| | |
|---|---|
| **Statement** | Daemon **step pickup-to-spawn** p95 **< 5 s** over a rolling 1 h window |
| **Signal source** | Step events: gap between the `leased` event (`dispatchStepToDaemon` leases the step) and the daemon's first `started`/session event when it spawns the CLI. Raw timestamps live on the step-event rows and on `TaskStep.startedAt`. |
| **Measure today** | **Not aggregated.** The raw timestamps exist and the delta is computable per step from the evidence packet, but nothing rolls it into a p95 or alerts on it. `doctor --daemon-e2e` proves the path works and prints a total wall-clock (`since()`), not the pickup component. |
| **Instrumentation needed** | Emit the `leased→started` delta as an OTel histogram (or one structured log line `dispatch.pickup_ms`) and export to a backend, then compute p95. Cheap: one `Date.now()` diff at the `started` event. Owner boundary note: that line lives in `dispatch.ts`/daemon-dispatch (not owned by F-6) — deferred to the dispatch lane. |
| **Alert threshold** | Page if p95 > 5 s for 15 min **once metered**. Until then: rely on `doctor --daemon-e2e` in CI and the dispatch-stalled runbook. |

## SLO-2 — Dispatch duplicate rate

| | |
|---|---|
| **Statement** | **Duplicate-dispatch rate = 0** (no step's attempt runs the adapter/LLM twice) |
| **Signal source** | B-1 mechanisms in `dispatch.ts`: lease-first (`leaseStep`), in-flight re-entry guard (`inFlightSteps`), and atomic attempt allocation against the `StepExecution (stepId, attempt)` unique index (`allocateExecution`). |
| **Measure today** | **Enforced structurally, not metered.** A second `StepExecution` for the same `(stepId, attempt)` is impossible — the DB unique constraint rejects it (P2002). Observable proxy: `dispatch` warn logs `attempt N … already exists — advancing to N+1`. **These are the guard *working*, not violations** — they count races that were correctly de-duplicated. A true violation would be two concurrent full adapter calls for one attempt; prevented by the lease + in-flight set, covered by the B-6 dispatch suite (dispatch-path AC 100%, file 94.7%). |
| **Instrumentation needed** | To *prove* zero at runtime rather than by construction: count distinct `started` step-events per `(stepId, attempt)` — should always be 1. Optional; the invariant is a DB guarantee. |
| **Alert threshold** | Any two `StepExecution` rows sharing `(stepId, attempt)` = SEV (structurally can't happen). A rising rate of "already exists — advancing" warns of poll-cycle overlap / slow prelude — investigate but not a duplicate. |

## SLO-3 — Stranded claim / lease age

| | |
|---|---|
| **Statement** | **Stranded-claim age p95 < 15 min** — leased/claimed work whose owner died is returned within the lease window |
| **Signal source** | Two mechanisms: **Model-B task claims** (`Task.claimExpiresAt`, 15-min renewable lease, `claim-reaper.ts` 60 s tick → BACKLOG, `task_claim_reaped` activity) and **step leases** (`LEASE_TIMEOUT_MS` = 10 min steal + daemon stale-sweep ~30 s → `lease_reclaimed` activity). |
| **Measure today** | **Partially measured — now surfaced by `doctor`.** `bun run doctor` runs a `stranded-work` check: counts IN_PROGRESS tasks past `claimExpiresAt` (with no active step) + `active` steps leased beyond `LEASE_TIMEOUT_MS`, both past a 90 s grace. Steady 0 = sweeps healthy. A non-zero count means a sweep isn't running (scheduler stopped / no poller on this DB). This is a **point-in-time gauge, not a p95** — the p95 of reclaim age is not computed. |
| **Instrumentation needed** | For a true p95: record `expiredAt→reclaimedAt` from the `task_claim_reaped` / `lease_reclaimed` activity details and aggregate. The bound is already structural: reaper 60 s + 15 min lease ⇒ worst case ≈ 16 min; step leases ≈ 30 s (stale) or ≤ 10 min (timeout steal). |
| **Alert threshold** | `doctor` `stranded-work` > 0 sustained across runs → warn (page if it climbs). Once metered: p95 reclaim age > 15 min → page. |

## SLO-4 — Realtime (board-ws) broadcast availability

| | |
|---|---|
| **Statement** | **board-ws `/healthz` availability ≥ 99%** and **broadcast attempt success rate ≥ 99%** over 1 h (measurable proxy for realtime delivery) |
| **Signal source** | `board-ws` `GET /healthz` → `200 {status:'ok', connections}` (liveness + live Socket.IO client count). Broadcast attempts: `broadcastProjectEvent` in `realtime.ts` logs `broadcast failed` (with HTTP status) when a POST `/broadcast` fails. |
| **Measure today** | **Availability: measured by `doctor`.** `realtime-service` check hits `/healthz`, requires 200 + `status:ok`, warn by default / **fail under `--smoke`**. **Delivery: NOT end-to-end instrumented.** We measure *broadcast attempt* success (server→board-ws POST), not client receipt — no per-client ACK exists. The `connections` gauge on `/healthz` is the best "clients are attached" proxy. When `AGENTBOARD_WS_INTERNAL_SECRET` is unset, `broadcastProjectEvent` silently no-ops (realtime disabled, board falls back to polling) — this is **degraded-but-healthy**, not a broadcast failure. |
| **Instrumentation needed** | True delivery SLO needs a client-side ACK or delivered-event counter (none today). Attempt success rate is cheap to compute now: count `broadcast failed` logs / total attempts (add a success counter alongside the existing failure log). |
| **Alert threshold** | `/healthz` unreachable → `smoke-test` fails (deploy gate); warn in normal `doctor`. `broadcast failed` log rate > 1% for 15 min → warn. Realtime unconfigured in **prod** is a hard env-validation failure (B-5), not an SLO breach. |

## SLO-5 — App health endpoint availability

| | |
|---|---|
| **Statement** | **`GET /api/health` availability ≥ 99.9%**, returns **200 within 1 s** over 1 h |
| **Signal source** | `src/app/api/health/route.ts` → `getHealthStatus()`: one DB `count` + env validation; **200** when ok, **503** when degraded (`status:'degraded'`, with `db`/`env`/`envIssues`). No auth (LB/monitor-safe, structure only). |
| **Measure today** | **Measured on demand, not continuously.** `doctor` `server` check + `--daemon-e2e` `waitForHealth` poll both assert 200 + `status:ok`. There is no standing uptime probe in-repo — an external monitor / LB healthcheck (F-1 compose healthchecks) should poll it. |
| **Instrumentation needed** | Point an uptime monitor (or the F-1 docker `healthcheck`) at `/api/health`; alert on non-200 or `status!=ok`. |
| **Alert threshold** | Any 503 or non-200 for > 2 consecutive probes → page. 503 body's `envIssues`/`db` says which. |

---

## How to read these right now

```bash
bun run doctor            # stranded-work (SLO-3), realtime /healthz (SLO-4), server /api/health (SLO-5)
bun run smoke-test        # same, but network checks (incl. board-ws /healthz) must PASS — deploy gate
bun run doctor --daemon-e2e   # end-to-end dispatch→spawn→complete (exercises SLO-1 path, no LLM spend)
curl -s localhost:3000/api/health | jq        # SLO-5 payload
curl -s ${AGENTBOARD_WS_URL:-http://127.0.0.1:3003}/healthz | jq   # SLO-4 liveness + connections
```

The honest summary: **SLO-4 (availability) and SLO-5 are measured; SLO-3 is
surfaced as a point-in-time gauge; SLO-1 and SLO-2 are structurally sound but
not yet metered.** Closing the metering gaps is a small amount of work
(histograms/counters on existing signals) gated on wiring an OTLP endpoint —
see the "Instrumentation needed" rows.
