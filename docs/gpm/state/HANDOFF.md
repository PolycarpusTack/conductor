# HANDOFF — resume here

> Written 2026-07-05, end of a long autonomous GPM run. Read this first, then
> `docs/gpm/state/mode.md` and `docs/gpm/state/development-plan-v1.md`.
> The GPM router is `CLAUDE.md`; the plan lives in `development-plan-v1.md`.

## One-line status

EPICs **A–F are complete and committed**. **EPIC G (hardening/1.0) is in progress** —
G-2 committed; G-1, G-3, G-4 were running as background agents when this session
paused and left **uncommitted edits in the working tree**. G-5 not started.

## FIRST THING TO DO TOMORROW — reconcile the working tree

Background subagents do **not** survive into a new session, but the files they
already wrote are still on disk, **uncommitted**. Before anything else:

```
git status --short
git stash list        # nothing expected; just confirming
bun run type-check
bun run lint           # real gate now (F-4)
bun test               # see "test flakiness" note below
```

The uncommitted edits belong to three stories. Decide per story whether the work
is **complete and coherent** (then verify + commit it) or **partial** (finish or
discard). Group the files by story — do NOT commit them all in one blob:

- **G-1 (Playwright e2e)** — owns: `playwright.config.ts`, `e2e/`, `package.json`
  (devDep + `e2e`/`e2e:ui` scripts), `bun.lock`, `.gitignore`. Check its final
  report was never seen by me, so: confirm the specs typecheck, that `bun test`
  still finds the unit suite and does **not** pick up `e2e/*.spec.ts` (they must
  be mutually exclusive), and whether chromium actually installed here (it may
  not have — the suite is likely CI-ready but unrun locally; that's acceptable,
  just record it).
- **G-3 (security re-review)** — owns: `src/lib/server/review-logic.ts`,
  `src/app/api/tasks/[id]/steps/[stepId]/route.ts` (reviewer identity binding),
  `src/lib/server/api-keys.ts` + `src/lib/server/legacy-key-purge.ts` +
  `scripts/purge-legacy-keys.ts` (plaintext key purge),
  `src/app/api/admin/session/route.ts` + `src/lib/server/login-rate-limit.ts`
  (rate limiter), `src/app/api/admin/security/keys/route.ts`, and the 3 new tests
  (`review-identity-binding`, `legacy-key-purge`, `login-rate-limit`). Verify the
  new tests pass and the reviewer-identity fix binds to the authenticated user
  (the sign-off-spoofing fix is the important one).
- **G-4 (board perf budget)** — owns: `src/app/(board)/board/page.tsx` (perf-only
  edits), `src/app/_views/__tests__/board-perf.test.ts`,
  `docs/ops/performance-budget.md`. Confirm the perf test passes and the board
  edits are behavior-preserving (E-5 memoization + D-1/D-3 + G-2 a11y intact).

If a story's edits look incomplete, re-run it as a fresh subagent with the same
brief (the briefs are recoverable from this file's story list + the plan).

## What's committed (git log, most recent first)

```
a68060d G-2 accessibility hardening      <- last commit
b4ceff2 F-5 debt re-baseline + EPIC F summary
05fed72 F-4 lint gate + any->0 + strict
f446a56 F-1/F-2 Docker + cross-platform start
a1a3dd0 F-3 ADRs + single-instance guard
e2f9620 F-6 SLOs + board-ws health + runbooks
```
Everything A–E is below that. Each EPIC has a phase summary in
`docs/gpm/state/phase-summaries/`.

## What remains in EPIC G

1. **G-1, G-3, G-4** — reconcile + commit per above (they may be done, just not
   committed by me).
2. **G-5 (the finale, do this yourself, not a subagent):**
   - **TD-024**: the Docker images/compose (F-1) were **never actually built** —
     no Docker on this dev host. This genuinely needs a machine with Docker. Do
     NOT fake a pass. Produce/verify a checklist: `docker compose up --build`,
     confirm the better-sqlite3 native compile in the Debian builder, the
     standalone tracing copies the `.node`, the in-container `prisma db push`
     runs, `/api/health` returns 200, and board-ws `/healthz` is reachable. If
     still no Docker host, leave TD-024 open and say so.
   - **Debt close-out**: mark TD-005 resolved (G-2 did it) and whatever G-3
     fixes; re-baseline `TECHNICAL_DEBT.md` if needed.
   - **1.0 cut**: bump `package.json` version (currently 0.4.0) to 1.0.0 once G is
     green; write the EPIC G phase summary.
   - **Re-run the seven-dimension evaluation** (the `current-state-evaluator`
     shape in `current-state-evaluation.md`) to measure against the A+ target
     ("all dimensions ≥ 8"). This is the closing deliverable — compare to the
     2026-07-03 baseline of 5.3/10.

## Standing context you'll want

- **Test flakiness (real, environmental):** on this Windows host under load, the
  `mini-services/conductor-daemon` fake-CLI **runner** tests can time out
  (5–11s spawn) and `evidence.test.ts` `git add` can fail. These are NOT
  regressions — re-run with no concurrent agents for a clean read (expect ~824
  green when quiet). Don't chase them as bugs.
- **Two carried risks (both tracked in TECHNICAL_DEBT.md):**
  - **TD-018b** — DAEMON-mode runs create no `StepExecution` rows, so budgets +
    cost analytics don't bind for daemon agents (only HTTP-path). Biggest real
    gap left in the dispatch model.
  - **TD-024** — Docker images unbuilt (above).
  - **TD-025** — daemon terminal failures never dead-letter.
- **Platform facts:** app server runs under **Node, not Bun** (better-sqlite3
  refuses Bun); production target is **Linux** (Windows standalone build is
  broken by a Turbopack `:` filename issue — dev-only on Windows via
  `bun run dev`). See ADR-0004 and the F phase summary.
- **Working style that's held all run:** one subagent per story on a disjoint
  file set; verify (`type-check` + `lint` + relevant `bun test` [+ `build` for
  routing/deploy changes]) then **commit per story** with a conventional-commit
  message ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
  schema changes serialize on one lane; parent finishes anything a subagent
  stops-and-reports (e.g. a boundary it couldn't cross).

## Where the numbers stand

Started from a 5.3/10 brownfield baseline (`current-state-evaluation.md`).
~40+ story commits across A–F. Test suite 531 → ~824. Lint is a real gate. Daemon
executes real agents behind a passing e2e smoke (`bun run smoke:daemon`). Frontend
is routed/typed/accessible/memoized. Deploy is containerized (unbuilt-verified).
The A+ target verdict is G-5's job.
