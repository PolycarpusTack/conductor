# HANDOFF — resume here

> **2026-09-07 planning update:** Current remaining-work order is in
> [working-program-2026-09-07.md](working-program-2026-09-07.md) and
> [backlog.md](../../../backlog.md). Read the
> [September baseline](current-state-review-2026-09-07.md) and
> [independent validation](backlog-validation-2026-09-07.md).
> H-1/H-2 completed under the user's execution instruction. Next eligible task:
> H-3-T1 daemon-tracer diagnosis. [Accepted evidence](evidence/H-2-verification.md):
> 925 tests pass, types/lint pass, actual offline fixture doctor has zero failures.
> CI changes are implemented; hosted CI and packaged build remain unverified.
> The rest of this file preserves July history and does not override that on-ramp.

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

**EPIC G1 "daemon parity" — IN PROGRESS (updated 2026-07-12).** G1-1 thin slice,
**4 of 5 tasks done** and committed, suite 847/0 after each. **All daemon-parity
correctness gaps are closed and unit-verified** — only the e2e smoke (T5) remains.
- **G1-1-T1 DONE** — extracted the Finalizer (`finalizeStepSuccess`/
  `finalizeStepFailure`, exported from `dispatch.ts`); HTTP rewired, zero change.
- **G1-1-T2 DONE** — daemon fail path → `finalizeStepFailure` (ADR-0008).
  Server-authoritative retry; `willRetry` a logged hint; exhaustion dead-letters
  + notifies + fallback. **Closes TD-025**, gaps 1.4/1.5.
- **G1-1-T3 DONE** — Execution Payload **v2**: `buildResolvedPrompt` extracted
  from prepareDispatch; daemon poll route resolves systemPrompt + instructions
  server-side (gap 1.1) + ships `previousOutput` (gap 1.2). Runner/validator/
  snapshot at v2.
- **G1-1-T4 DONE** — `StepExecution` row per daemon attempt: created at poll time
  (steps/next) + `startedAt` stamped (gap 1.7); completion finalizes it —
  `succeedExecution` with cost lifted from the `claude run metadata` artifact on
  success, real `executionId` into `finalizeStepFailure` on fail. Budget gate
  (source-agnostic `StepExecution.cost` sum) now binds daemon spend. **Closes
  TD-018b.** (TD-018b + TD-025 marked Resolved in TECHNICAL_DEBT.md.)

**G1-1-T5 — STARTED, BLOCKED on a pre-existing daemon-run-loop issue (2026-07-13).**
Ran `bun run smoke:daemon` live. Findings:
- The smoke now progresses far past its old documented "red at register" state —
  app-boot ✓, login ✓, setup ✓, workspace ✓, **daemon-register + start ✓** (the
  `z.record`→`z.partialRecord` fix is in; the stale doctor comment is corrected).
- **FAILS at `e2e-step-completed`**: the step stays `active` past the timeout. The
  daemon polls and the server serves the step (`GET /api/daemon/steps/next 200` —
  so the v2 payload route is fine, NOT a G1 regression), but the step is never
  completed. This is the daemon **execution loop** (spawn the generic-template
  fixture `bun scripts/daemon-e2e-fixture.ts` on stdin → run → POST completion),
  not the payload. Very likely **pre-existing** (the smoke has been red at register,
  so this last mile hasn't been exercised recently); needs debugging with the FULL
  daemon tail (the smoke truncates it to 400 chars — raise that or run the daemon
  standalone). Odd observation to chase: `Agent/Task/ProjectRuntime WHERE id IN
  (NULL)` queries right after the poll's step query (harmless to serving, but worth
  understanding). Each smoke iteration ≈ 3.5 min on this Windows host (71s boot) —
  a faster/Linux host is strongly preferred for this loop.
- **All G1-1 correctness work (T1–T4) is done and unit-verified (847/0)** — T5 is the
  e2e proof + new assertions, gated on getting the run loop green first.

**G1-2 DONE (2026-07-13)** — review-rejection feedback reaches daemon agents (gap
1.3): the v2 payload carries `rejectionNote`; the daemon `composeInstructions`
appends the same HUMAN-FEEDBACK block as the HTTP path. Unit-verified (daemon suites
72/0 isolated). Independent of the smoke.

**G1-4 DONE (2026-07-13, commit 92ad233)** — remaining parity bundle (gap 1.7):
(a) fallback escalation on the daemon fail path verified + tested, AND a real fix:
both daemon routes now allocate StepExecution rows via
`findOrCreateRunningExecution` (execution-log.ts) — only a still-`running` latest
row is reused, terminal rows are allocated past — so a post-fallback re-run
(attempts reset to 0) can no longer resurrect/overwrite the failed agent's
recorded attempts; (b) `agent.maxConcurrent` enforced at daemon lease time in
`dispatchStepToDaemon` (count other active steps, demote to pending at cap — HTTP
parity); (c) optional top-level `modeInstructions` in the v2 payload carries the
server-layered mode-instruction string (agent-mode override ||
projectMode.instructions + outputFormat hint); the daemon `composeSystemPrompt`
prefers it over its legacy agent-record parse (snapshot updated, no version bump).
Unit-verified: 39/0 across the 4 touched server suites + runner suite green
(one documented TD-014b spawn-timeout flake, passes isolated) + type-check clean.

**G1-3-T0 SPIKE DONE (2026-07-13) — GO.** `state/spike-g1-3-mcp-config.md`: claude
2.1.207 `--mcp-config`/`--strict-mcp-config` verified headlessly with a live stdio
MCP fixture; `${VAR}` env indirection works in stdio `env` AND http `headers`
(secrets never in payload/argv/config values); A13 CONFIRMED. Two traps became T1
ACs: unset `${VAR}` passes through as a literal silently (daemon must pre-validate
env vars), and broken MCP servers degrade silently (detect via stream-json
`system:init` `mcp_servers[].status === "failed"`; `"pending"` at init is healthy).

**G1-3-T1 DONE (2026-07-13, commit cfc22d4)** — MCP for daemon agents (gap 1.6):
`src/lib/server/daemon-mcp-config.ts` builds a sanitized `mcpServers` fragment
(project-scoped; auth headers must be `${ENV_VAR}` templates — a literal
credential is refused via `configError`, which follows the commandError
contract); payload gains the optional `mcp` field. Daemon: env vars validated
pre-spawn, temp config + `--mcp-config --strict-mcp-config --allowedTools
mcp__<name>__*`, init-status `"failed"` fails the step; template/echo runners
documented unsupported (steps proceed without tools). Unit-verified both sides
+ type-check clean.

**G1-5 DONE (2026-07-13) — EPIC G1 COMPLETE** (T5 smoke carried to a Linux-host
session). Close-out: `phase-summaries/phase-summary-epic-G1.md` (incl. retro),
architecture-memory refreshed (daemon path at engine parity, ADR-0007/0008
listed, debt lines current), runbook caveats swept (daemon-step-stuck.md,
budget-pause-recovery.md).

**EPIC G3 IN PROGRESS (2026-07-13; owner chose it — A12 failed for good, G2
parked).** Expansion critic-reviewed in the backlog. **G3-1 + G3-2 COMPLETE**
(skills consumption per ADR-0010; embed-on-save + full CRUD + versioning
de-claim). See RESUME.md for the G3-3-T1 on-ramp (spec-MCP transport).
Open owner decision: G3-5 schema lane (backlog G3-5 line).

- On a Linux host ever appearing: G2 proper + the carried G1-1-T5 smoke assertions.
- **G1-5** — close-out (phase summary + architecture-memory; register already updated).

**T5 smoke (skipped for now) — when the loop is green, add these parity assertions**
(run the live harness, don't write blind):
- resolved-token: assert the payload/prompt the fixture receives has no `{{ }}`.
- forced-fail → retry → dead-letter: extend the daemon fixture
  (`scripts/daemon-e2e-fixture.ts`) to fail on a signal; assert a dead-letter row
  + notification appear after exhaustion.
- StepExecution row + cost present for the attempt.
- budget pause: set a tiny `Project.budgetUsd`, run a costed daemon step, assert
  the next tick skips the project.
Note: the app boots under **node** inside the smoke (better-sqlite3); the doctor
harness itself runs under Bun. `smoke:daemon` was green pre-G1 (13-check) — keep it
green. **Then** G1-2 (rejectionNote — payload already carries the context; add a
`rejectionNote` field in `buildResolvedPrompt`'s output + the payload, wire it into
the daemon runner `composeInstructions`), G1-3 (MCP spike), G1-4 bundle, G1-5
close-out (phase summary + architecture-memory; the register is already updated).

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
