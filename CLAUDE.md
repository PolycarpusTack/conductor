# GPM Pipeline — Router

This repo runs the Guided Partnership Model. Rules are in docs/gpm/;
NEVER load them all — read the file for your current stage only.

## Always
- Read docs/gpm/state/mode.md first. Mode governs everything (ceremony,
  TDD, gates). If missing or stale (>1 EPIC old), ask before proceeding.
- Current remaining-work plan: docs/gpm/state/working-program-2026-09-07.md
  + backlog.md; current findings and validation are linked there. Older July
  plans preserve completion history but no longer select the next task.
- Working context per task = architecture-memory.md + the relevant
  snapshots/ files + the task spec. Budget ≤3k tokens of project context;
  if exceeded, the memory needs updating or the task is too broad — say so.
- Every repo claim in specs is marked (verified)/(NEW)/(ASSUMED). If the
  repo contradicts a spec twice, or once on schema/interface/security:
  STOP, report expected vs observed, do not improvise.

## Stage → read
- New idea / feature request → docs/gpm/solution-design-template-v1.md
- Accepted design → decompose  → docs/gpm/backlog-builder-v5.1.md
  (agents: backlog-builder-policy-kernel + annexes; then backlog-critic-agent)
- Executing a task            → docs/gpm/gpm-v2.1.md §your-phase +
  the matching template (zap/cip/gen-tests-template)
- Anything about principles, DoD, modes, economics →
  docs/gpm/core-specification-v1.md — the single home of the rules
- Brownfield baseline → docs/gpm/state/current-state-review-2026-09-07.md
  (evaluator report — substitutes for the evaluator agent)
- The active development plan → docs/gpm/state/working-program-2026-09-07.md

## Model routing
Follow the Delegation Charter in docs/gpm/gpm-deployment-kit-v1.md §6.
Judgment → reasoning tier. Generation from clear spec → execution tier.
Checklist verification → light tier. Default down, escalate on evidence.

## After each accepted component
Write/update the Contract Snapshot in docs/gpm/state/snapshots/.
After each EPIC: update architecture-memory.md + write a phase summary.

## Project conventions (Conductor)
- Runtime: Node for app/doctor; Bun for tooling/tests (ADR-0007).
  Tests: `bun run test` (includes timeout/path filters). Types: `bun run type-check`.
- DB: Prisma — SQLite default, Postgres+pgvector optional (docker compose).
- Verify then commit on main (no PR flow for solo work) — see memory.
