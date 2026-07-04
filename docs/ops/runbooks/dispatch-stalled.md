# Runbook — Dispatch stalled / no steps progressing

**Symptoms.** Tasks sit `IN_PROGRESS` (or steps stay `active`) and nothing
advances. No new `started`/`succeeded` step events. Agents look idle. The board
may still render fine — this is a *dispatch* problem, not a UI problem.

Relevant SLOs: SLO-1 (pickup latency), SLO-3 (stranded work). See
[../slos.md](../slos.md).

## Checks (in order)

```bash
bun run doctor                 # look at: stranded-work, llm-runtimes, daemons, database
curl -s localhost:3000/api/health | jq      # db/env ok? 503 → fix env/db first
```

1. **Is the scheduler polling this project?**
   Dispatch is driven by a per-project `setInterval` (`scheduler.ts`).
   - Project `automationMode: manual` **never auto-polls**. Start automation in
     project settings, or kick one cycle:
     ```bash
     curl -X POST localhost:3000/api/internal/poll-steps \
       -H "x-internal-secret: $AGENTBOARD_WS_INTERNAL_SECRET"
     ```
     If that single poke *does* advance steps, the scheduler isn't running for
     the project → it's `manual`, or the app was restarted without automation
     re-arming (`automationMode` must be `always`/`startup` to self-start).
   - `scheduled` mode: outside the configured window the poller is intentionally
     stopped. Check the schedule.

2. **Single-instance / poller constraint.**
   The scheduler is a **per-process, single-instance** design (in-process
   `setInterval`, no distributed lock — see architecture-memory). If you run
   **two** app instances against **one DB**, behavior is undefined and steps can
   appear to stall or double-poll. Run exactly one instance with the scheduler,
   or ensure only one has automation armed. (Runtime guard for this is F-3.)

3. **Budget pause.**
   A project whose month-to-date spend ≥ `budgetUsd` is **skipped entirely**
   every tick (`filterBudgetPausedProjects`). Look for a `budget_exceeded`
   activity row / `[budget]` warn log. → [budget-pause-recovery.md](budget-pause-recovery.md).

4. **No usable runtime / agent paused.**
   - `doctor` `llm-runtimes` = 0 → agents can't dispatch; configure a runtime.
   - The poller only selects steps whose agent has `runtimeId != null` **and**
     `isActive = true` (D-4). A **paused agent** silently parks its steps. Un-pause it.
   - Adapter unavailable (missing API key env var) → steps fail fast with
     `Adapter "…" not available`.

5. **Stranded leases (owner died).**
   `doctor` `stranded-work > 0` means claims/leases are past expiry but no sweep
   reclaimed them — which itself means **no poller is running** (each poll runs
   the stale sweep + `pollAndDispatch`). Fix the poller (steps 1–2); the next
   ticks will steal expired leases (`LEASE_TIMEOUT_MS` 10 min) and reap claims
   (60 s reaper).

6. **Realtime secret unset (a red herring for dispatch).**
   `AGENTBOARD_WS_INTERNAL_SECRET` gates realtime broadcasts *and* the
   `/api/internal/poll-steps` poke — but **not** the in-process scheduler.
   Dispatch works without it; only the manual poke returns `503 Internal secret
   not configured`. Don't chase the WS secret for a genuine dispatch stall
   unless you were relying on the poke. (If the *board* isn't updating but steps
   *are* completing, that's [realtime-not-updating.md](realtime-not-updating.md).)

7. **DAEMON-mode steps specifically** (agent `invocationMode: DAEMON`).
   Different failure surface — see [daemon-step-stuck.md](daemon-step-stuck.md)
   and the [EPIC A runbook](../../gpm/state/phase-summaries/epic-A-runbook.md).

## Resolution

- Arm automation (`always`/`startup`) or poke `/api/internal/poll-steps`.
- Collapse to a single scheduler instance per DB.
- Raise budget or wait for UTC month roll-over ([budget-pause-recovery.md](budget-pause-recovery.md)).
- Configure runtime / un-pause the agent.
- After fixing the poller, confirm `doctor` `stranded-work` returns to 0.

## Escalation

If a single poke advances steps but the scheduler still won't self-run with
`automationMode: always`, capture `[scheduler]` logs (`LOG_LEVEL=debug`) and the
output of `bun run doctor --json`, and escalate to the dispatch/engine owner —
this points at scheduler init (`initializeScheduler`) not arming, a candidate for
the F-3 single-instance runtime guard.
