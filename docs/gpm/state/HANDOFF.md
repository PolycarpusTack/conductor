# HANDOFF — resume here

> Written 2026-07-05; updated 2026-07-10 (EPIC G0 pass). Read this first, then
> `docs/gpm/state/mode.md` and `docs/gpm/state/development-plan-v1.md`.
> The GPM router is `CLAUDE.md`. The road to 1.0 now follows the review-driven
> **`docs/gpm/state/backlog-2026-07-10-working-program.md`** (EPICs G0–G4),
> backed by `GAP-ANALYSIS-2026-07-10.md` + `FUNCTIONALITY-REVIEW-2026-07-10.md`
> at the repo root, which supersede the G-1..G-5 sketch below.

## One-line status (updated 2026-07-10)

EPICs **A–F complete**. **In-flight tree RECONCILED** (G-1 Playwright, G-3
security, G-4 perf — committed per story). **EPIC G0 "green gates" COMPLETE** —
all 4 Tier-0 gaps closed: type-check honest, `bun run doctor` passes on the
default install (node via tsx, ADR-0007), `bun run dev` boots (health 200/db ok),
**first verified production build** (BUILD_ID exists), `verify` = type-check +
lint + test + build + doctor. Unit suite 842/0 quiet (the `verify` chain can
still trip on TD-014b mock-order flakiness under load — not a regression).

**EPIC G1 "daemon parity" — IN PROGRESS (updated 2026-07-11).** G1-1 thin slice,
2 of 5 tasks done and committed, suite 843/0 after each:
- **G1-1-T1 DONE** — extracted the Finalizer (`finalizeStepSuccess`/
  `finalizeStepFailure`, exported from `dispatch.ts`); HTTP path rewired onto it,
  zero behaviour change (dispatch suite 86/0 unchanged). `executionId` nullable +
  `eventMeta` optional so the daemon path can share it.
- **G1-1-T2 DONE** — daemon fail path routes through `finalizeStepFailure`
  (ADR-0008). Server decides retry vs terminal from the step's own maxRetries;
  daemon `willRetry` is a logged hint, never obeyed. Exhaustion now dead-letters +
  notifies + escalates to fallback. **Closes TD-025**, gaps 1.4/1.5.

**RESUME AT G1-1-T3** (discovery done — payload v2: resolved prompt + previousOutput):
- Server side: `src/app/api/daemon/steps/next/route.ts` — today it ships raw
  `instructions` + `agent.systemPrompt` with literal `{{task.title}}`/
  `{{memory.recent}}` tokens (gaps 1.1/1.2). Run `resolvePrompt` server-side
  (`src/lib/server/resolve-prompt.ts` — check its full token set vs how
  `dispatch.ts prepareDispatch` applies it) over instructions/systemPrompt, add
  `previousOutput` (previous step's output), bump `payloadVersion: 2`.
- Daemon side: `mini-services/conductor-daemon/runner.ts` —
  `EXECUTION_PAYLOAD_VERSION` const, `validateExecutionPayload` (accept v2),
  `composeUserBody` (~line 179, include previousOutput). Since the server
  pre-resolves, the daemon uses resolved text as-is. Update `runner.test.ts`.
- Snapshot: `docs/gpm/state/snapshots/daemon-execution-payload.md` → Version 2.
- Then **T4** (StepExecution row per daemon attempt at lease → finalized by the
  Finalizer, passing the real `executionId` instead of null; cost/turns from the
  claude metadata artifact; closes TD-018b, binds budgets) and **T5** (extend
  `bun run smoke:daemon` — note it runs under Bun via `Bun.spawn`, ADR-0007 — with
  parity assertions). Then G1-2 (rejectionNote), G1-3 (MCP spike), G1-4 bundle,
  G1-5 close-out.

Then G2 "proven deploy" (needs a Docker/Linux host — TD-024, migrations,
`--accept-data-loss` removal, WAL), G3 "truth in features", G4 "UX coherence"
(from FUNCTIONALITY-REVIEW), 1.0 cut + seven-dimension re-eval as close-out.

## Superseded original status (2026-07-05)

EPICs A–F complete; G-2 committed; G-1/G-3/G-4 were uncommitted background-agent
edits (**now reconciled — see above**); G-5 not started.

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
