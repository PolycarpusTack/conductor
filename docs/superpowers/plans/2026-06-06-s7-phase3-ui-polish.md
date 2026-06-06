# S7 Phase 3 — Config Forms + Automation Activity + v0.3.0

Final S7 phase per the design doc: per-action config forms instead of raw JSON,
and a read-only "recent automation activity" list on the Automation tab. Then
release v0.3.0 (S4 + S6 + S7 since v0.2.0).

**Verified against codebase 2026-06-06:**
- The add-reaction form keeps `newRxnConfig` as a JSON string — structured forms
  parse it and write back, so the string stays the single source of truth.
- The activity API already filters by `component` (the Activity tab sends it);
  Phase 1 actions log with `component: 'automation'`.
- Releases bump package.json and add a "What's new" help section
  (see `release: v0.2.0`, 2830c5f shape).

## Task 1 — Structured config forms for internal actions

- [x] settings-integrations.tsx: when the picked reaction type is internal, the
  JSON textarea is replaced by a per-type form that round-trips through
  `newRxnConfig`: agentRole select + agentId input + force checkbox
  (task:assign), priority select (task:set-priority), maxRetries/retryDelayMs
  numbers (task:set-retry), "no config needed" note (task:archive),
  bumpPriority/reassignFallback checkboxes (step:escalate). Outbound types keep
  the JSON textarea. ReactionRow's edit stays raw JSON (advanced path) — noted
  as an accepted limitation.

## Task 2 — Recent automation activity on the Automation tab

- [x] SettingsAutomation fetches `/api/activity?projectId=…&component=automation&limit=15`
  and renders a read-only list (time, rule action, target) under the time-based
  rules block; empty state explains that rules log here when they fire.

## Task 3 — Release v0.3.0

- [x] package.json 0.2.0 → 0.3.0.
- [x] Help "What's new in 0.3" section: mode policy (S4), task templates (S6),
  automation rules engine (S7 all phases).
- [x] Roadmap header notes everything S1–S7 shipped; full verification; release
  commit.

> **Implemented 2026-06-06.** Deviations: none. ReactionRow editing keeps the raw
> JSON textarea as the advanced path, as planned.
