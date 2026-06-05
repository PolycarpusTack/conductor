# Ops Layer Epic 7: Installer & Doctor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployment can verify itself: `bun run doctor` checks runtime, env, Prisma client, database, runtimes, daemons, and (unless offline) the live server + realtime service; `bun run smoke-test` is the strict-online variant for post-deploy gates; CI runs the offline doctor on every push.

**Architecture:** One script, `scripts/doctor.ts` (bun resolves tsconfig paths — `backfill-hosts.ts` precedent), with a small check-runner: each check returns `pass | warn | fail` + detail; exit 1 only on `fail`. Local checks reuse what already exists — `validateEnv` (v0.0.6) for configuration, `db.project.count()` for connectivity (same probe as `/api/health`). Network checks (`/api/health`, board-ws reachability) are skipped by `--offline` and demoted to `warn` by default (polling fallback is legitimate); `--smoke` promotes them to `fail`. `--json` for machines. **No global `agentboard` binary in v1** — `bun run doctor` in-repo is the deviation from the design's CLI framing; packaging comes when there's a distribution story. Daemon `install` (OS service registration) stays documentation (platform-specific); daemon *status* is a doctor check.

**Context (verified):** CI (`.github/workflows/ci.yml`) pushes a SQLite ci.db before tests — the doctor step slots after Test with the same `DATABASE_URL`. `getHealthStatus` exists but imports the full env validation path — doctor calls `validateEnv` and `db` directly to keep failure attribution per-check. board-ws has no health route; an unauthenticated POST `/broadcast` answering 401 proves reachability.

**Tech Stack:** Bun, TypeScript 5

> **Implemented 2026-06-05.** Deviations from the plan as written (and the design doc):
> - No global `agentboard` binary — `bun run doctor` / `bun run smoke-test` in-repo; packaging waits for a distribution story.
> - Daemon `install` is documentation (wrap the start command in systemd/launchd/Windows service); daemon `status` is a doctor check + the Hosts tab.
> - The design's `bash -n` installer linting has nothing to lint — there are no shell installers; CI runs the offline doctor itself as the validation.
> - First local run immediately surfaced the known better-sqlite3 bindings failure on the dev machine — the doctor finding real problems on day one.

---

## File Map

| File | Change |
|---|---|
| `scripts/doctor.ts` | New — check runner + checks, `--offline` / `--smoke` / `--json` |
| `package.json` | `doctor` + `smoke-test` scripts |
| `.github/workflows/ci.yml` | Doctor step after tests |
| `INSTALL.md` | Verify section uses doctor; daemon install/status pointers |
| `mini-services/conductor-daemon/README.md` | Note: daemon status visible via doctor / Hosts tab |

---

### Task 1: doctor script
- [x] Check runner: `{ name, severity: pass|warn|fail, detail }[]`, human output with ✓/!/✗, `--json` structured, exit 1 iff any fail.
- [x] Local checks: bun/node version; `.env` present (warn); `validateEnv()` (fail on invalid); admin password configured (warn when absent outside production); realtime secrets (warn); Prisma client generated (`src/generated/prisma` exists, fail); DB reachable via `db.project.count()` (fail); ≥1 runtime configured (warn); daemon census (info-as-pass: total/online).
- [x] Network checks (skip with `--offline`): `GET {CONDUCTOR_URL|http://localhost:3000}/api/health` and board-ws reachability (`{AGENTBOARD_WS_URL|http://127.0.0.1:3003}/broadcast` answering at all) — `warn` by default, `fail` under `--smoke`.
- [x] `package.json`: `"doctor": "bun scripts/doctor.ts"`, `"smoke-test": "bun scripts/doctor.ts --smoke"`.
- [x] Verify locally: `bun run doctor --offline` exits 0 against the dev DB.

### Task 2: CI integration
- [x] Add step after Test: `bun scripts/doctor.ts --offline --json` with `DATABASE_URL: file:./prisma/ci.db`.

### Task 3: Docs
- [x] INSTALL.md: replace the curl-based Verify section with doctor/smoke-test; daemon install pointer (OS service registration documented as manual, with the README's start command).
- [x] conductor-daemon README: status via doctor + Hosts tab.

### Task 4: Wrap-up + v0.2.0 release
- [x] Full verification; checkboxes; deviations.
- [x] Release v0.2.0 — Epics 4–7 (content safety, messaging, evidence, doctor): version bump, help page, release commit.

## Out of scope
- Global `agentboard` CLI binary / npm packaging.
- OS service installers (systemd/launchd/Windows service) for the daemon — documented manual setup.
- `bash -n` installer linting from the design — there are no shell installers to lint.
