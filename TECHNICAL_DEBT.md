# Technical Debt Register

> Last re-baselined: 2026-07-04 (F-5, after EPICs A–F)
> Severity: 🔴 blocking · 🟠 high · 🟡 medium · ⚪ low
>
> This register is reviewed at each EPIC retro (GPM cadence). Resolved items are
> kept below for history. Numbering is stable — IDs are never reused.

## Active

| ID | Sev | Description | File(s) | Disposition |
|----|-----|-------------|---------|-------------|
| TD-018b | 🟡 | Daemon runs create no `StepExecution` rows — cost/turns/session_id ride a JSON artifact, so B-7 budgets and cost analytics do **not** bind for DAEMON-mode agents (only HTTP-path). The biggest correctness gap remaining in the dispatch model. | mini-services/conductor-daemon/evidence.ts, src/lib/server/step-queue.ts | Wire daemon results into StepExecution rows — next daemon iteration (candidate EPIC G or a follow-on) |
| TD-024 | 🟠 | The Docker images + compose (F-1) were **never built** — Docker was absent from the dev host. Every non-Docker link is verified, but the container build (Debian better-sqlite3 compile, standalone tracing completeness, in-container `prisma db push`) is unproven. | Dockerfile, docker-compose.yml, mini-services/board-ws/Dockerfile | Run `docker compose up --build` on a Docker host before any production use; fold into EPIC G |
| TD-025 | 🟡 | Daemon terminal failures never dead-letter — `POST /api/daemon/steps` fail path marks the step failed but never calls `moveToDeadLetter` (only the HTTP path does), so daemon failures are invisible to the dead-letter/requeue panel. | src/app/api/daemon/steps/route.ts | Route daemon exhaustion through moveToDeadLetter (with TD-018b) |
| TD-014b | 🟡 | Cross-file `mock.module` load-order fragility — several test suites depend on alphabetical execution order because Bun's mock registry is shared across files (seen in B-2, D-3). | src/lib/server/__tests__/** | Harness fix (per-file mock isolation) — EPIC G test hardening |
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
| TD-018 ✅ (partial) | Adapter cost dropped on the HTTP path | B-7 wires `result.cost` + estimate fallback; daemon remainder tracked as TD-018b |
| TD-E ✅ | Frontend stack drift (unused deps, prop drilling, no memoization, a11y) | EPIC E (routing, contexts, typed client, dnd-kit, memoization, dep cleanup) |
| TD-F(lint) ✅ | ESLint rules mostly disabled, `any` unguarded | F-4: rules re-enabled as errors, any→0, noImplicitAny + reactStrictMode on |
| TD(ADR) ✅ | No ADRs — cross-cutting decisions were tribal | F-3: ADR-0001..0006 |
| TD(deploy) ✅ (code) | No Dockerfile, POSIX-only start | F-1/F-2: Docker images, compose, cross-platform launcher (build-verification tracked as TD-024) |
| TD-A ✅ | Daemon execution layer absent | EPIC A |
| TD-B ✅ | Model-B task claims had no lease/reaper | B-2 |
| TD-C ✅ | dispatchStep leased late → double-dispatch race | B-1 |
| TD-D ✅ | Scoped API keys instance-wide | B-4 |
