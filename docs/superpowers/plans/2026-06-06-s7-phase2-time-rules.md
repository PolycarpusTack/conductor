# S7 Phase 2 — Time-Based Rules (Sweep + Synthetic Events) + Archived View

Per the S7 design doc: clock-driven rules don't get their own engine — a sweep
manufactures synthetic events (`task-stale`, `review-gate-stale`) through
`fireProjectEvent`, and the normal trigger/filter/reaction flow (including the
Phase 1 internal actions) decides what happens.

**Verified against codebase 2026-06-06:**
- `initializeScheduler` already runs a 60s global tick (`checkScheduledProjects`)
  — the sweep hooks there, self-limited to once/hour per project via a claimed
  `lastAutomationSweepAt` timestamp (updateMany-claim avoids double sweeps).
- Human gates sit at `TaskStep.status='active'`, `mode='human'`; `startedAt` is
  NOT set by `activateStep`, so staleness uses `startedAt ?? createdAt` (an upper
  bound — a gate can't have waited longer than it has existed).
- Project PUT destructures fields explicitly — new fields must be added there.
- The Activity tab already hosts the S3 deleted-tasks restore list — the
  Archived list mirrors it.

## Task 1 — Schema + sweep module (TDD)

- [x] Project += `autoArchiveDays Int?`, `reviewEscalationHours Int?`,
  `lastAutomationSweepAt DateTime?`.
- [x] `src/lib/server/automation-sweep.ts`: `runAutomationSweeps()` — projects
  with either knob set and sweep older than 1h; claim via updateMany; fire
  `task-stale` for DONE, unarchived, undeleted tasks idle > N days (cap 50/sweep,
  log the cap) and `review-gate-stale` for active human steps older than N hours
  (cap 50). Events only — archiving/escalation happen via triggers.
- [x] `TRIGGERABLE` += both events; `eventTypeSchema` += both.
- [x] Tests: claims hourly (second call no-op), fires task-stale only for
  qualifying tasks, fires review-gate-stale with waitingHours, no knobs = no events.

## Task 2 — Wiring + settings + UI

- [x] scheduler.ts: global tick calls `runAutomationSweeps().catch(...)`.
- [x] Contracts + project PUT: `autoArchiveDays` (1–3650), `reviewEscalationHours`
  (1–720), both nullable.
- [x] Automation tab: "Time-based rules" block with the two inputs (blank = off)
  saved via project PUT, with helper text pointing at Integrations for the
  matching trigger.
- [x] Activity tab: "Archived tasks" list mirroring the deleted-tasks block
  (fetch archived-tasks, Unarchive button).
- [x] Integrations UI: EVENT_TYPES += the two new events.
- [x] Help: Phase 2 reality replaces the "phases 2-3" callout remainder; roadmap
  updated; full verification; commits per task.

> **Implemented 2026-06-06.** Deviations: none of substance. Sweep settings save
> through the existing project PUT with their own button on the Automation tab
> (separate from the scheduler form, which posts to a different endpoint).
