# Incident Runbooks

Operator-voice, one incident per page. Each: **symptoms → checks → resolution →
escalation**. Start every investigation with:

```bash
bun run doctor                                   # local + network health
curl -s localhost:3000/api/health | jq           # app health (503 = degraded)
curl -s ${AGENTBOARD_WS_URL:-http://127.0.0.1:3003}/healthz | jq   # board-ws liveness
```

## Runbooks

| Incident | Runbook |
|---|---|
| Dispatch stalled / no steps progressing | [dispatch-stalled.md](dispatch-stalled.md) |
| Realtime / board not updating | [realtime-not-updating.md](realtime-not-updating.md) |
| Daemon step stuck / `workspace_unmapped` / `is_error` | [daemon-step-stuck.md](daemon-step-stuck.md) |
| Budget pause recovery | [budget-pause-recovery.md](budget-pause-recovery.md) |
| Database issues (SQLite locked / Postgres switch) | [database-issues.md](database-issues.md) |

## Related

- **SLOs** — [../slos.md](../slos.md): what "healthy" means numerically and how it's measured.
- **EPIC A daemon runbook** — [../../gpm/state/phase-summaries/epic-A-runbook.md](../../gpm/state/phase-summaries/epic-A-runbook.md): deep daemon-execution operator guide (evidence locations, requeue, e2e smoke). The daemon runbook here links into it rather than duplicating it.
- **EPIC A+B phase summary** — [../../gpm/state/phase-summaries/phase-summary-epics-A-B.md](../../gpm/state/phase-summaries/phase-summary-epics-A-B.md): what leasing/reaper/budget machinery exists and why. *(No standalone EPIC-B runbook exists; the B-story mechanics live in this summary and in the individual runbooks below.)*

## Log locations

- **App / scheduler / dispatch / budget / claim-reaper** — the Next process stdout/stderr. Prod: one JSON line per event (`getLogger` tag identifies the module: `dispatch`, `scheduler`, `budget`, `claim-reaper`, `realtime`). Dev: `[LEVEL] [tag] message`. Raise detail with `LOG_LEVEL=debug`.
- **board-ws** — its own process stdout (`[WS] …` lines).
- **Daemon** — the daemon host's stdout, plus per-step `AgentSession` rows (`GET /api/sessions?taskId=…`) and step events (`GET /api/tasks/{taskId}/steps/{stepId}/evidence`).
- **Activity log** — in-app per project (`GET /api/activity?projectId=…`): `lease_reclaimed`, `task_claim_reaped`, `budget_exceeded`/`budget_lifted`, `daemon_dispatch_failed`.
