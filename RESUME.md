# RESUME — pick up here after reboot

> Written 2026-07-13, end of a long session. This is the fast on-ramp. The
> authoritative detail is in `docs/gpm/state/HANDOFF.md` (read it second).
> Tree is clean; all work below is committed on `main`.

---

## ▶ Paste this as your first prompt next session

```
Resume the Conductor "road to 1.0" work. Read RESUME.md and docs/gpm/state/HANDOFF.md
first. We are mid-EPIC-G1 "daemon parity": G1-1 (T1–T4) + G1-2 are done and
unit-verified; the T5 smoke is skipped (blocked on a pre-existing daemon run-loop
issue). Continue with G1-4 (the remaining-parity bundle) unless I say otherwise.

Discipline to keep: work one backlog task at a time; after each, run the affected
tests + `bun run type-check` and only commit when green (one commit per task,
conventional message ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
Prefer running individual test files — the full 88-file suite has documented flaky
spawn/git tests under host load (TD-014b) that pass in isolation; don't chase them.
The app + tests run under NODE, not Bun (ADR-0007). Verify with a quiet host.
```

---

## Where we are (one screen)

**Project:** Conductor (`C:\Projects\AgentBoard`) — Bun/Next/Prisma agent-orchestration
platform that runs GPM on itself. **Goal:** the review-driven road to a working 1.0.

**Driving docs (at repo root unless noted):**
- `GAP-ANALYSIS-2026-07-10.md` — the four-track gap review (Tier 0–3).
- `FUNCTIONALITY-REVIEW-2026-07-10.md` — how the app works + conceptual critique.
- `docs/gpm/state/backlog-2026-07-10-working-program.md` — the EPIC G0–G4 plan.
- `docs/gpm/state/HANDOFF.md` — detailed resume state (READ THIS).
- `TECHNICAL_DEBT.md` — register (TD-018b + TD-025 now Resolved).

**Done this session (20 commits on `main`, all green):**
- **EPIC G0 "green gates" — COMPLETE.** All 4 Tier-0 gaps: type-check honest
  (`.next/dev` excluded), `bun run doctor` passes on the default install (runs under
  node via `tsx`, ADR-0007), `bun run dev` boots (health 200/db ok), **first verified
  production build** (BUILD_ID exists), `verify` = type-check+lint+test+build+doctor.
- **EPIC G1 "daemon parity" — G1-1 (T1–T4) + G1-2 done, unit-verified.** The daemon
  execution path now has correctness parity with HTTP:
  - T1 — extracted the shared Finalizer (`finalizeStepSuccess`/`finalizeStepFailure`
    in `dispatch.ts`).
  - T2 — server-authoritative retry + dead-letter/notify/fallback (ADR-0008, **closes
    TD-025**, gaps 1.4/1.5). Daemon `willRetry` demoted to a logged hint.
  - T3 — Execution Payload **v2**: server-resolved prompt (no literal `{{tokens}}`,
    gap 1.1) + `previousOutput` (gap 1.2). `buildResolvedPrompt` extracted from
    prepareDispatch.
  - T4 — `StepExecution` row per daemon attempt + cost from the metadata artifact +
    `startedAt` (**closes TD-018b**, gap 1.7-partial); budgets now bind daemon spend.
  - G1-2 — review-rejection note reaches daemon agents (gap 1.3).

**Gaps closed:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.7(startedAt); TD-018b + TD-025 resolved.

---

## The next task — G1-3 (MCP for daemon agents) or G1-5 (close-out)

**G1-4 DONE (2026-07-13, commit 92ad233)** — all three parity blocks landed +
tested (fallback verified + post-fallback StepExecution allocation fixed via
`findOrCreateRunningExecution`; `maxConcurrent` at daemon lease time; server-layered
`modeInstructions` in the v2 payload, snapshot updated). See HANDOFF.md.

**EPIC G1 COMPLETE (2026-07-13)** — G1-3 (MCP via `--mcp-config`, spike + impl),
G1-4 (parity bundle), G1-5 (close-out: `phase-summary-epic-G1.md`,
architecture-memory, runbook sweep) all done. Only the T5 e2e smoke is carried
(pre-existing run-loop issue; needs a Linux host).

**G3 EXPANDED (2026-07-13, critic-reviewed)** — owner chose "truth in features";
A12 FAILED (no Linux/Docker host, ever) so G2 is parked (G2-2 pulled into
G3-7-T0) and G3-5 (Reaction Outbox) is HOLD on an owner schema-lane decision.
Execution order: G3-1 → G3-2 → G3-3 → G3-4 → G3-6 → G3-7.

Next: **G3-1-T0** — ADR-0010 "Skill consumption model", then G3-1-T1 (inject
attached skills in buildResolvedPrompt).

## After G1

- **G2 "proven deploy"** — needs a **Docker/Linux host** (TD-024: images never built;
  adopt `prisma migrate`, remove `--accept-data-loss`, add WAL/busy_timeout, e2e the
  built artifact). Do not attempt on this Windows dev host.
- **G3 "truth in features"** — skills agents can't consume, semantic search returns 0
  rows, cross-project KPIs absent, MCP not spec-compliant (see gap analysis Tier 1C).
- **G4 "UX coherence"** — merge WAITING+REVIEW, honest drag/pause, split `isActive`,
  fix the in-app help (see FUNCTIONALITY-REVIEW §2.6).
- **1.0 cut** + re-run the seven-dimension evaluation (baseline was 5.3/10).

## Skipped, needs a focused session on a faster/Linux host

- **G1-1-T5** (daemon e2e smoke). `bun run smoke:daemon` now reaches daemon-register+start
  (the old zod blocker is fixed) but fails at `e2e-step-completed`: the step stays
  `active` — the daemon polls and the server serves the v2 payload (GET 200, so NOT a
  payload regression), but the run loop never completes it. Likely pre-existing.
  ~3.5 min/run on Windows (71s boot). Needs full daemon logs. Details in HANDOFF §T5.

## Environmental gotchas (don't relearn these)

- **Node runs the app + tests; Bun is tooling only** (ADR-0007). `bun run dev` /
  `bun run doctor` delegate to node for you.
- **Test suite is now deterministically green** (855/0) — TD-014b **RESOLVED**
  (2026-07-13): the `test` script uses `--timeout 30000` (the conductor-daemon spawn
  tests exceeded bun's 5s default under load), `verify` runs `bun run test` (was bare
  `bun test`), and a leak-safe `dbMock()` helper (`src/lib/server/__tests__/db-mock.ts`)
  makes a leaked partial db mock a no-op instead of `is not a function`. New partial
  db mocks should use `dbMock({...})`.
- **Windows standalone build is broken** (Turbopack `:` filenames) — dev-only here;
  production target is Linux.
- Repo convention: solo work commits straight to `main`; commit per story; verify
  before commit.
