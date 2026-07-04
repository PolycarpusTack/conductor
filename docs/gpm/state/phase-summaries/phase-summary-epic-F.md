# Phase Summary — EPIC F (Ops, Debt & Governance)

Date: 2026-07-04. Commits `e2f9620..05fed72` + this state commit.

## What was built

- **F-6 SLOs + doctor + runbooks** (e2f9620): reconciled the board-ws health contradiction (route existed; doctor comment was stale), made doctor check /healthz for real + a stranded-work gauge; docs/ops/slos.md (5 SLOs, honest measurement status); 6 incident runbooks.
- **F-3 ADRs + single-instance guard** (a1a3dd0): ADR-0001..0006 backfilling every previously-tribal decision; SchedulerLock + scheduler-lock.ts (DB advisory lock, owner runs pollers, standby takes over on stale TTL). Agent stopped at the schema lane; parent added the model + activated the guard.
- **F-1/F-2 Docker + deploy** (f446a56): multi-stage Dockerfile (Bun build, Node runtime — see finding), board-ws Dockerfile, full docker-compose (SQLite default + optional postgres profile), dependency-free cross-platform start.mjs, INSTALL/README rewrite.
- **F-4 lint + quality gate** (05fed72): ESLint correctness rules back as errors; production `any` 1→0; noImplicitAny + reactStrictMode on.
- **F-5 debt re-baseline** (this commit): TECHNICAL_DEBT.md rewritten into active/resolved; architecture-memory ADR + debt sections refreshed.

## What was learned (findings that reshaped the work)

- **better-sqlite3 v12 refuses to run under Bun** (F-1). Not an ABI issue — an explicit guard. Since SQLite is the default DB, the app server must run under Node; the old `bun .next/standalone/server.js` start was already broken for the default path. New rule everywhere: **build with Bun, run with Node.** This is the single most important ops finding.
- **The "pre-existing EINVAL standalone-copy warning" is explained** (F-1): Turbopack emits chunk filenames containing `:` (`[externals]_node:buffer`), which NTFS can't write — so the Windows standalone build is genuinely incomplete. Linux (the deploy target) writes them fine. Windows is dev-only.
- **The brownfield "~93 any" was mostly false** (F-4): almost all in the ESLint-ignored generated Prisma client or Record<string,unknown> false matches. Ground-truth production any was 1. A reminder to measure before scoping.
- **board-ws already had /healthz** (F-6): the doctor comment claiming otherwise was stale; the entry-point inventory was right. Two reviews disagreed; the code was the tiebreaker.

## Plan deviations

- F-3's single-instance guard needed a one-line schema model the agent didn't own; it correctly stopped-and-reported and the parent completed it (added SchedulerLock, activated).
- F-4 left `no-undef` off (59 false positives on a TS codebase — tsc covers it) — evidence-based deviation from the plan's rule list.
- F-1 could not run `docker build` (Docker absent) — images are code-reviewed and every non-Docker link verified, but the container build is unproven (TD-024).
- F-1 runs the app under Node not Bun (better-sqlite3), and documented the Postgres profile as advanced (schema provider hardcoded sqlite, ADR-0004).

## Debt

Register re-baselined (TECHNICAL_DEBT.md). New this EPIC: TD-024 (unverified Docker build, 🟠), TD-025 (daemon failures never dead-letter, 🟡), TD-014b (test mock load-order, 🟡), TD-018b (daemon StepExecution rows — carried, 🟡). Resolved: TD-E, TD-F(lint), TD(ADR), TD(deploy-code), plus older TD-006/009/010/014.

## Retro (flow)

- 5 stories: 3-wide wave 1 (F-1/F-3/F-6) then F-4 solo (lint gate can't run concurrent with source edits), F-5 by parent.
- Rework: 0; 2 parent completions (F-3 schema activation, F-1 build-verification gap documented not hidden).
- Suite 819 → 824; type-check/lint/build green; **lint is now a real gate** (rules on) for the first time in the project's history.
- Honest gaps carried forward, not papered over: TD-024 (Docker unbuilt), TD-018b (daemon cost/budget), TD-025 (daemon dead-letter).
- Next: EPIC G (Playwright e2e incl. daemon smoke, a11y audit, security re-review, 500-task perf, verify TD-024 on a Docker host, 1.0 cut).
