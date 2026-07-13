# Runbook — Daemon step stuck / `workspace_unmapped` / `is_error`

**Symptoms.** A step run by a **DAEMON-mode** agent won't progress: sits `active`
and never starts, leases but never completes, or fails with `workspace_unmapped`
/ a claude-runner `is_error`.

This runbook is a **triage entry point** — the deep operator guide for daemon
execution already exists and is authoritative:

➡️ **[EPIC A Runbook — Daemon Execution](../../gpm/state/phase-summaries/epic-A-runbook.md)**

Go there for: symptom→check tables, evidence locations (`AgentSession`, step
events, artifacts), requeue behavior, and the spend-free e2e smoke. This page
only routes you and adds the ops-level cross-references.

## Fast triage

```bash
bun run doctor                 # daemons row: N/M online; stranded-work
bun run doctor --daemon-e2e    # spend-free end-to-end proof of the daemon path
```

| Symptom | Jump to (EPIC A runbook section) |
|---|---|
| Step `active`, never starts | "Step sits `active`, nothing ever starts" — daemon online **in the project's workspace**? agent `invocationMode=DAEMON` + adapter→capability map? project has a workspace? automation polling? |
| Leased but never completes | "Step leased but never completes" — daemon died; stale sweep releases in ~30 s (`lease_reclaimed`, `reason: daemon_stale`), else 10-min lease steal. |
| `workspace_unmapped` | "Steps fail with `workspace_unmapped`" — daemon's `DAEMON_WORKSPACE_ROOT` invalid/missing or path escaped root. Fix env, restart daemon. |
| Exit 0 but `is_error` | "Claude-runner failures with exit 0" — the stream-json result line is authoritative; usually CLI auth/model problems in the daemon env. |
| `command template rejected` | "`unknown tokens`" — `commandTemplate` may only use `agent.runtimeModel`, `task.id`, `step.id`, `step.mode`. |

## Cross-references to other runbooks

- If **no** daemon step is progressing *and* HTTP steps also stall, the problem
  is upstream (scheduler/budget/single-instance) → [dispatch-stalled.md](dispatch-stalled.md).
- `doctor` `stranded-work > 0` for daemon steps ⇒ the stale sweep isn't running
  ⇒ no poller ⇒ [dispatch-stalled.md](dispatch-stalled.md) steps 1–2. (SLO-3, [../slos.md](../slos.md).)

## Resolved gaps (EPIC G1 "daemon parity", 2026-07-13)

The two big EPIC A/B caveats no longer apply:

- **Daemon terminal failures now dead-letter + notify** exactly like HTTP steps
  (G1-1-T2, ADR-0008 — the server owns retry/dead-letter; the daemon's
  `willRetry` is a logged hint). Fallback-agent escalation also applies.
- **Daemon runs create `StepExecution` rows** (G1-1-T4): created at poll time,
  finalized on completion with cost lifted from the `claude run metadata`
  artifact — budgets and cost analytics bind for DAEMON agents.

New failure modes worth knowing (G1-3 MCP):

- `mcp config rejected: …` — the server refused the agent's MCP connection
  config (missing endpoint, literal secret in an auth header, unknown
  connection id). Fix the connection in Settings → MCP; secrets must be
  `${ENV_VAR}` templates.
- `mcp env vars not set on this daemon host: …` — provision the listed vars in
  the daemon's environment and restart it.
- `mcp server(s) failed to start: …` — the daemon host could not reach/start a
  promised MCP server; check the server URL/health from the daemon host.

## Escalation

If `bun run doctor --daemon-e2e` **passes** but a real daemon step is stuck, the
problem is environmental on the daemon host (CLI auth, workspace, network to
`CONDUCTOR_URL`), not the engine — collect the daemon stdout + the step's
`AgentSession.outputPreview` and escalate to whoever owns that daemon host. If
the e2e smoke itself **fails**, escalate to the daemon/engine owner with the
`--json` output (note the known `e2e-daemon-register` schema issue documented in
the EPIC A runbook).
