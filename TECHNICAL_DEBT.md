# Technical Debt Register

> Last re-baselined: 2026-07-04 (F-5, after EPICs A–F)
> Severity: 🔴 blocking · 🟠 high · 🟡 medium · ⚪ low
>
> This register is reviewed at each EPIC retro (GPM cadence). Resolved items are
> kept below for history. Numbering is stable — IDs are never reused.
>
> **EPIC G0 "green gates" — COMPLETE (2026-07-10). All 4 Tier-0 gaps closed:**
> - G0-0: working tree reconciled — G-1/G-3/G-4 committed per story.
> - G0-1 (gap 0.1): type-check honest — `.next/dev` excluded; negative-tested.
> - G0-2 (gap 0.2): `bun run doctor` passes on the default install — runs under
>   node via `tsx`; DB check reachable; 10 checks, 0 failed (ADR-0007).
> - G0-3 (gap 0.3): runtime story pinned (ADR-0007); `bun run dev` boots on
>   default SQLite — /api/health 200, db ok; README corrected.
> - G0-4 (gap 0.4): **first verified production `next build`** — BUILD_ID +
>   `.next/static` exist; `verify` = type-check + lint + test + build + doctor.
>
> Unit suite **deterministically green** (855/0, verified across repeated runs).
> **TD-014b is RESOLVED (2026-07-13):** the flaky `verify` had two causes — the
> conductor-daemon spawn tests exceeding bun's 5s default under load (fixed:
> `test` script now `--timeout 30000`, and `verify` runs `bun run test` not bare
> `bun test`), and the cross-file `mock.module` `is not a function` crash (fixed:
> the leak-safe `dbMock()` helper, `src/lib/server/__tests__/db-mock.ts`).
> **Next: EPIC G1 "daemon parity."** Gap detail: `GAP-ANALYSIS-2026-07-10.md`;
> plan: `docs/gpm/state/backlog-2026-07-10-working-program.md`.

## Active

| ID | Sev | Description | File(s) | Disposition |
|----|-----|-------------|---------|-------------|
| TD-024 | 🟠 | The Docker images + compose (F-1) were **never built** — Docker was absent from the dev host. Every non-Docker link is verified, but the container build (Debian better-sqlite3 compile, standalone tracing completeness, in-container `prisma db push`) is unproven. | Dockerfile, docker-compose.yml, mini-services/board-ws/Dockerfile | Run `docker compose up --build` on a Docker host before any production use; **EPIC G2**. |
| TD-016 | ⚪ | commandTemplate tokens validated at poll/spawn time, not when `ProjectRuntime.config` is written — bad templates surface late. | src/app/api/daemon/steps/next/route.ts | Validate in the runtime-config settings API |
| TD-015 | ⚪ | Workspace-less step retries every poll tick, writing a `daemon_dispatch_failed` activity entry each time — no dedupe. | src/lib/server/daemon-dispatch.ts | Dedupe or park after N identical failures |
| TD-017 | ⚪ | Generic runner argv split is whitespace-based — no quoting for args with spaces (documented in the daemon README). | mini-services/conductor-daemon/runner.ts | Add quoted-arg parsing if a template needs it |
| TD-019 | ⚪ | Server persists step output at `MAX_OUTPUT_CHARS=5000` (head-truncated) while the daemon ships a 64KB tail — full text survives only in artifacts/session events. | src/app/api/daemon/steps/route.ts | Revisit when the board renders long outputs |
| TD-020 | ⚪ | HTTP-path cost uses blended per-token estimates when the adapter reports tokens but no true cost; unknown models record null (budget never binds on estimate alone for them). | src/lib/server/dispatch.ts, cost-estimator.ts | Have adapters compute true cost from per-direction tokens |
| TD-021 | ⚪ | `budget_lifted` written only on the first tick with a dispatchable step; project GET recomputes spend per request. | src/lib/server/budget.ts | Accepted — audit-only + one indexed SUM |
| TD-022 | ⚪ | `agent-memory-panel.tsx` error toasts use sonner, whose `<Toaster>` is never mounted — those errors render nowhere. | src/components/agent-memory-panel.tsx | Migrate to use-toast (toast-system consolidation) |
| TD-023 | ⚪ | Data layer is hand-rolled (reads/mutations patch `currentProject`, reconciled by WS). @tanstack/react-query installed but unused (E-2b **deferred** by owner). | src/hooks/*, board-context.tsx | Adopt react-query only if manual cache mgmt becomes a demonstrated pain; else drop the dep |
| TD-002 | ⚪ | Prompt archive: no recursive subfolder support. | src/lib/server/prompt-library.ts | Future iteration if needed |
| TD-003 | ⚪ | Prompt archive: no file watcher — changes need an app restart. | src/lib/server/prompt-library.ts | chokidar watch in v2 |
| TD-005 | 🟡 | Prompt-archive picker: no keyboard navigation (a11y gap). | prompt-archive-picker.tsx | aria + keyboard handler — fold into EPIC G a11y audit |
| TD-011 | ⚪ | Wizard keyword search is naive (no stemming/synonyms). | wizard-composer.ts | Embeddings-based search in v2 |
| TD-012 | ⚪ | `COMPOSE_PROMPT` is a hardcoded template string. | wizard-composer.ts | Make configurable in settings |
| TD-013 | ⚪ | No retry/timeout on the LLM call in composeAgent. | wizard-composer.ts | Add timeout + backoff |

## Resolved

| ID | Description | Resolution |
|----|-------------|------------|
| TD-001 ✅ | Prompt archive re-read from disk every request | 60s in-memory cache (Task 5.1) |
| TD-004 ✅ | No search/filter in the archive picker | Client-side filter added (Task 5.2) |
| TD-006 ✅ | Inline fetch in PromptArchivePicker | Superseded by E-2a typed API client |
| TD-007 ✅ | `reviewForm` dep-array warning | E-4/F-4: exhaustive-deps now a lint warning, reviewed |
| TD-008 ✅ | Review form uses getValues() | Accepted design; no live-validation requirement emerged |
| TD-009 ✅ | Wizard composing step was a placeholder | Wired in Epic 4 (wizard-composer) |
| TD-010 ✅ | Runtimes API returned a bare array | Standardized in E-2a endpoints |
| TD-014 ✅ | composeAgent trusted LLM JSON shape | `composeResultSchema` + safeParse (wizard-composer.ts) |
| TD-014b ✅ | Cross-file `mock.module` load-order fragility + spawn-test flakiness made `verify` non-deterministic | **2026-07-13**: `test` script `--timeout 30000` (spawn tests exceeded bun's 5s default under load) + `verify` runs `bun run test` (was bare `bun test`, which skipped the path filters); leak-safe `dbMock()` helper (`__tests__/db-mock.ts`) so a leaked partial db mock is a no-op, never `is not a function`. Adopted in the 4 known-partial files. Suite 855/0 across repeated runs. |
| TD-018 ✅ (partial) | Adapter cost dropped on the HTTP path | B-7 wires `result.cost` + estimate fallback; daemon remainder tracked as TD-018b |
| TD-018b ✅ | Daemon runs created no `StepExecution` rows — cost/budgets/analytics didn't bind for DAEMON agents | **G1-1-T4**: StepExecution created at daemon lease (steps/next), finalized on completion; cost lifted from the `claude run metadata` artifact into `StepExecution.cost`; startedAt stamped. Budget gate (source-agnostic `StepExecution.cost` sum) now binds daemon spend. |
| TD-025 ✅ | Daemon terminal failures never dead-lettered — invisible to the panel/bell | **G1-1-T2**: daemon fail path routes through the shared `finalizeStepFailure` (ADR-0008); exhaustion dead-letters + notifies + escalates to fallback, at parity with HTTP. |
| TD-E ✅ | Frontend stack drift (unused deps, prop drilling, no memoization, a11y) | EPIC E (routing, contexts, typed client, dnd-kit, memoization, dep cleanup) |
| TD-F(lint) ✅ | ESLint rules mostly disabled, `any` unguarded | F-4: rules re-enabled as errors, any→0, noImplicitAny + reactStrictMode on |
| TD(ADR) ✅ | No ADRs — cross-cutting decisions were tribal | F-3: ADR-0001..0006 |
| TD(deploy) ✅ (code) | No Dockerfile, POSIX-only start | F-1/F-2: Docker images, compose, cross-platform launcher (build-verification tracked as TD-024) |
| TD-A ✅ | Daemon execution layer absent | EPIC A |
| TD-B ✅ | Model-B task claims had no lease/reaper | B-2 |
| TD-C ✅ | dispatchStep leased late → double-dispatch race | B-1 |
| TD-D ✅ | Scoped API keys instance-wide | B-4 |
