# Phase Summary — EPIC D (Product Completeness)

Date: 2026-07-03/04. Commits `e4e6798..8734c20` (6 story commits).

## What was built

- **D-1 board search + filters** (e4e6798): text/agent/priority/tag filter over the loaded project; memoized selector preserving array identity when inactive; distinct no-match state.
- **D-5 password reset + email invites** (7cb9882): PasswordResetToken (hash-only, expiring); tokenized set-password links; no user enumeration; temp-password fallback when SMTP off.
- **D-6 project export/import** (825a57b): allow-list redaction (drops opaque runtime config, renames apiKeyEnvVar→envVar); import remaps ids two-pass, keyless agents; redaction test scans serialized bundle.
- **D-4 agent pause** (dbcb285): **found two latent bugs** — dispatcher never filtered isActive (pausing was cosmetic; steps kept running) and updateAgentSchema stripped isActive (PUT couldn't set it). Both fixed + regression-tested; pause/resume toggle + badges in sidebar/settings/cards; WS broadcast on toggle.
- **D-2 due dates** (70f0ca9): Task.dueDate + end-of-day-UTC storage; Intl-formatted card badge (soon/overdue); overdue filter (additive to D-1); exactly-once overdue reminder via compare-and-set dueReminderSentAt.
- **D-3 bulk operations** (8734c20): POST /api/tasks/batch (transactional, project-scoped, idempotent); keyboard-accessible selection coexisting with E-4 drag + E-5 memoization; per-action undo.
- **D-7** was already done (d1e5cfb).

## What was learned

- **D-4 is the headline finding**: the review's "agent pause exists (isActive)" was wrong twice over — the flag was neither enforced by the dispatcher nor settable via the API. A feature can be present in the schema and the UI and still be entirely non-functional; the story that "just surfaces existing behavior" is exactly where latent bugs hide. Regression test added.
- E-8's dep removals shaped D-2/D-3: react-day-picker and date-fns were gone, so due dates use a native date input + Intl formatting — simpler and dependency-free, validating the E-8 cleanup.
- The E-3 context + E-5 memoization held up under feature load: D-1 filter and D-3 selection both added state without reintroducing whole-board re-renders (selection costs one render on mode-toggle only).

## Plan deviations

- D-2 used @@index([dueDate]) not the plan's suggested [status, dueDate] (status is notIn, not equality — justified).
- D-6 dropped runtime config wholesale rather than filtering inside it (opaque blob, allow-list safer) and omitted MCP connections (unrequested, secret-bearing).
- D-3 kept selection in board-local state, not context (ephemeral, avoids invalidating consumers).
- D-4's WS-broadcast-on-toggle was added by the parent (one line in the agents PUT route) since the agent's boundary excluded that route.

## Debt / follow-ups

- No new debt items. Existing open: TD-018-remainder (daemon StepExecution rows — budgets/overdue-cost blind for DAEMON agents), TD-022 (sonner unmounted), TD-023 (deferred query migration), ADR-1..6 unwritten.
- D-3 test-infra note: bun's shared mock.module registry made a session-based 401 test flaky; rewritten to the API-key path. The cross-file mock load-order fragility (flagged since B-2) is now a recurring pattern worth a harness fix in EPIC F.

## Retro (flow)

- 6 stories, mostly 3-wide parallel then serialized on the shared card file (board-task-card touched by D-2/D-3/D-4 — sequenced cleanly, zero conflicts).
- Rework rate: 0; 1 parent-side completion (D-4 broadcast line).
- Suite 725 → 819 tests, green throughout; type-check/lint/build green at every commit.
- Bugs found by building: D-4's two isActive bugs, plus A-4's daemon-registration bug earlier — the pattern holds that execution/e2e surfaces defects static review misses.
- Next: EPIC F (ops: Dockerfile, cross-platform scripts, ADR backfill, lint re-enable, debt re-baseline, SLOs) then G (Playwright e2e, a11y audit, security re-review, perf, 1.0).
