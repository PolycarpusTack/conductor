# Conductor: current-state review, 2026-09-07

Scope: bounded source and evidence reconciliation for the September GPM plan,
using the collection's current-state evaluator. Numeric health ratings are not
invented where measurements are unavailable. Source baseline: e85706e, version
0.4.0. No application changes or additional test execution occurred in this review.

## 1. Code health

**R-01 — Verification is not reproducible across supported entry points.** Fresh checks supplied by the coordinating reviewer: type-check passed; lint passed with four warnings; offline doctor reported ten checks, zero failures and three warnings. Bun 1.3.13 reported 604 passes, 43 failures and 27 errors across 93 files. An isolated `projects.test` rerun produced eight failures because Bun could not resolve installed `mustache`; Node resolved both `mustache` and `@opentelemetry/api`, while Bun did not. The full-suite log is in the reviewing host's OS temporary directory as `agentboard-review-tests-20260907.log`; archive it with the remediation evidence.

These are fresh observations from the coordinating review, not tests rerun by this evaluator. They establish a failing verification environment, not 43 confirmed application defects. CI still invokes bare `bun test` and `bun scripts/doctor.ts` (`.github/workflows/ci.yml:43,48`), bypassing the package test timeout/exclusions and Node/tsx doctor entry point (`package.json:11,16`). First action: diagnose module resolution, make runtime instructions match actual scripts, align CI, and classify remaining failures from a reproducible run. Route: `test-quality-auditor` and `pragmatic-programmer`.

Coverage percentage/trend, suite speed, TDD adherence, smell density, duplication and whole-codebase readability: **UNKNOWN — no fresh measurement**. This bounded source review is not a code-smell census. Do not use the July test-to-source LOC ratio as coverage or reassert the historical 94.7% dispatch coverage as current.

**Score: UNKNOWN — evidence does not support a calibrated numeric rating.**

## 2. Architecture health

**R-05 — Daemon MCP permissions are broader than the configured tool selection.** The server selects connection metadata without `scopes` (`src/lib/server/daemon-mcp-config.ts:62`) and emits URL/header configuration (`:107`). The Claude runner grants `mcp__<server>__*` (`mini-services/conductor-daemon/runner.ts:376`). HTTP discovery does filter per-tool scopes and mode allowlists (`src/lib/server/mcp-resolver.ts:81,89,131`). First action: preserve and enforce effective per-tool permissions through daemon payload/runner, including empty-deny semantics; verify restricted tools cannot execute. Route: `integration-pattern-advisor`, with a security review.

**R-06 — HTTP MCP remains a raw JSON-RPC client.** Discovery posts `tools/list` directly (`src/lib/server/mcp-resolver.ts:110`); execution posts `tools/call` directly (`:200`). Both use only a content-type header and parse JSON; the inspected implementation contains no initialization/session lifecycle, configured auth expansion or external-URL safety check. Discovery failures become an empty tool list (`:146`). First action: complete the scoped G3-3 transport/auth/endpoint work with protocol contract tests and clear failure feedback. This is source evidence of missing behavior, not a live interoperability test. Route: `integration-pattern-advisor`.

**R-08 — Reaction delivery has no durable event handoff.** Trigger evaluation launches an unawaited promise and swallows rejection (`src/lib/server/triggers/evaluator.ts:52`). The executor records failure state but breaks the reaction sequence (`src/lib/server/reactions/executor.ts:98,116`). A process restart can lose pending work. First action: design transactional enqueue, delivery identity, retry/backoff, explicit handling of dependent reactions and failed-delivery visibility. Preserve legitimate reaction-output dependencies when changing stop-on-failure behavior. Route: `integration-pattern-advisor`.

ADRs exist, including runtime, leases, budgets, auth, daemon retry and skills. Dependency graph, coupling cycles, automated architecture coverage and contract coverage: **UNKNOWN**. Existing decisions are assets; their correctness is not established merely by documentation.

**Score: UNKNOWN — bounded integration findings, no complete architecture assessment.**

## 3. Domain model health

**R-02 — Task board status does not consistently control execution.** Task PUT writes validated fields directly and only specially handles starting an untouched chain on `IN_PROGRESS` (`src/app/api/tasks/[id]/route.ts:66,81`). Moving an active chain to Backlog or Done does not stop its steps. Active-step polling filters task deletion/project, not task status (`src/lib/server/step-queue.ts:27,34`); throttled-step polling does require `IN_PROGRESS` (`:73`). First action: define task Pause/Resume/Cancel semantics, valid transitions and late-result handling, then enforce them across board, API and both dispatch paths. Route: `building-block-classifier`, `context-integration-advisor`.

**R-03 — Presence and operator permission share `isActive`.** Dispatch checks `isActive: true` (`src/lib/server/step-queue.ts:38`), while heartbeat writes it true (`src/lib/server/agent-helpers.ts:52`); listing agent tasks does likewise (`src/app/api/agent/tasks/route.ts:26`). An agent request can therefore undo an operator pause. First action: separate presence from execution permission and verify heartbeat, queued work and in-flight behavior. Route: `building-block-classifier`.

**R-11a — Waiting/Review vocabulary contradicts workflow behavior.** Status resolution sends human/no-runtime waits to `WAITING` (`src/lib/server/dispatch.ts:965,988`), while help describes four columns and automatic review-gate entry into `REVIEW` (`src/components/help/help-content.tsx:954,960`). First action: decide the state model before renaming or merging columns; align help and migration/compatibility behavior. Route: `ubiquitous-language-guard`.

Vocabulary is partially documented; lifecycle invariants show concrete gaps. Complete aggregate/context analysis and domain-layer purity measurements: **UNKNOWN**.

**Score: UNKNOWN — lifecycle problems verified, wider domain assessment incomplete.**

## 4. Delivery flow health

**R-14 — Forecasting and outcome evidence is unavailable.** No live board history, item-level cycle-time distribution, throughput, WIP history, flow efficiency, unplanned-work rate or customer outcome data was supplied. Commit counts and test counts are not substitutes. First action: record item start/finish/block dates, publish current WIP and review completed outcomes; forecast only after sufficient comparable observations. Route: `flow-metrics-advisor`, `backlog-health-advisor`, `product-owner-coach`.

The July working program provides priorities, dependencies and DoR/DoD expectations, but contains stale next-action text and closed work described as open in story introductions. Enforcement in actual delivery is **UNKNOWN**. Use the September plan as the next-work index while preserving historical completion evidence.

**Score: UNKNOWN — measured delivery data unavailable.**

## 5. Technical debt health

**R-13 — Planning memory contained material contradictions at review start.** The July `architecture-memory.md` described both a one-route SPA and the newer routed frontend; it called the daemon real execution at parity while its glossary still said “protocol only today” and “execution absent.” Its “Node runs the app/tests” summary conflicted with the actual Bun test script (`package.json:11`). Historical coverage and stable-engine claims were not fresh validation. The July `RESUME.md` similarly contained stale “skills agents can't consume” text after recording G3-1/G3-2 completion. **Planning resolution:** the September package refreshes architecture memory and adds current entry points while retaining July history. Continue this discipline at each epic closeout. Route: `architectural-decision-recorder`, `technical-debt-classifier`.

Debt is **tracked**: `TECHNICAL_DEBT.md:32–47` lists 16 active entries, including unverified Docker delivery (TD-024), skill version history (TD-026), estimated cost limitations (TD-020), and manual client state management (TD-023). The existence/count of entries is verified; their individual severity and completion status were not all re-audited. Carry them forward without inflating this review into a second debt register.

TD-014b records July fixes for mock leakage and spawn timeout problems (`TECHNICAL_DEBT.md:61`). R-01 has fresh module-resolution evidence; do **not** reopen all TD-014b as the proven same cause. Debt interest, repayment cost, tipping points and capacity ratio: **UNKNOWN**.

**Score: UNKNOWN — register available, debt economics unmeasured.**

## 6. Operational readiness

**R-04 — API-key administration has authentication but no role gate.** Key list/create/revoke use `requireAdminSession` (`src/app/api/admin/api-keys/route.ts:20,28,51`). That helper accepts any valid session; the separate `requireRole` performs rank checks (`src/lib/server/admin-session.ts:136,161`). A valid member session therefore passes these routes' visible gate. First action: enforce the agreed administrative role and verify member/admin/owner behavior. Route: security reviewer plus `test-quality-auditor`.

**R-07 — Schema upgrades and built deployment remain unproven.** Startup executes `db push --accept-data-loss` (`docker-entrypoint.sh:21`); no migration files were found under `prisma`. The comment declaring this safe is not safety evidence. First action: baseline a supported database lane, prove upgrade/restore on a copy, remove automatic acceptance of destructive changes, and validate the built deployment on an available target. Historical A12/G2 host constraints remain recorded; no current host availability was verified here. TD-024 remains open.

**R-09 — Live reconnection does not restore missed state.** The socket allows five retries and then stops (`src/hooks/useWebSocket.ts:73,85`); its connect handler changes only connectivity state (`:79`). First action: recover connection credentials where needed, provide a retry path and refetch authoritative state after reconnect. Verify a disconnect spanning updates without reloading the page.

**R-12 — Latest daemon parity lacks an end-to-end completion gate.** July G1-1-T5 is explicitly carried after a served step did not complete (`RESUME.md`, “Skipped” section). Earlier EPIC A's passed tracer bullet does not close this later gate. No Docker, live daemon or production E2E was run in this review. First action: capture full daemon/server logs and demonstrate completed execution, evidence/cost recording and failure/review recovery on the current build. Route: `test-quality-auditor`.

Fresh production health, latency/error/saturation baselines, measured SLOs, deploy frequency and recovery time: **UNKNOWN**. Runbooks and instrumentation are documented; their operating effectiveness was not tested.

**Score: UNKNOWN — source-level blockers known, production observations unavailable.**

## 7. Product value health

**R-10 — Workspace navigation is incomplete.** Switching workspace sets local UI state (`src/components/board-header.tsx:113`), but the project dropdown maps the full projects list (`:182`) loaded without a workspace filter (`src/hooks/useProjectData.ts:63`). Skills consume the selected workspace, making behavior inconsistent across surfaces. First action: define workspace selection scope and consistently filter/navigation-reset project data; distinguish this UX issue from unproven authorization claims.

**R-11b — Cross-project KPI claims exceed the shown implementation.** README advertises cross-project KPIs (`README.md:21`); help repeats that promise (`src/components/help/help-content.tsx:521,2219`); the dashboard fetches only `/api/projects/${projectId}/analytics` (`src/components/observability-dashboard.tsx:94`). First action: deliver clearly defined rollups if validated as useful, or correct the claims. Route: `product-owner-coach`, `ubiquitous-language-guard`.

Purpose is clear: coordinate AI execution, human review and evidence/costs across projects. Feature usage, satisfaction, adoption, time-to-value and EBM measures: **UNKNOWN** (R-14). Guided setup, execution-blocker explanations and operator journey validation are valuable hypotheses, not demonstrated customer demand.

**Score: UNKNOWN — coherent purpose, insufficient outcome evidence.**

## CURRENT STATE EVALUATION

Project: Conductor (AgentBoard), v0.4.0. Date: 2026-09-07. Evaluator: `current-state-evaluator-agent` from the requested collection. Source baseline: latest recorded commit `e85706e`, July 13; fresh verification supplied by the coordinating reviewer, representative code inspected independently. Planning only; no application changes or tests rerun here.

**Critical findings:** R-01 obscures regression confidence; R-02/R-03 undermine execution control; R-04/R-05 undermine permission expectations; R-06/R-07/R-12 block confident integration/deployment claims.

| Dimension | Qualitative assessment | Numeric score |
|---|---|---|
| Code | Verification inconsistency established | UNKNOWN |
| Architecture | Integration boundaries need completion | UNKNOWN |
| Domain | Execution/status invariants inconsistent | UNKNOWN |
| Delivery flow | Plans exist; actual flow unavailable | UNKNOWN |
| Technical debt | Register exists; summaries conflict | UNKNOWN |
| Operations | Upgrade/permission gaps; E2E unproven | UNKNOWN |
| Product value | Clear purpose; trust gaps; outcomes unmeasured | UNKNOWN |

**Delta by named finding, not score:** G0 gate repair and production build are historically complete; fresh type-check/doctor remain positive while R-01 qualifies suite confidence. G1 prompt/context, retries/fallback/dead-letter, attempts/costs and review feedback are implemented, with T5 explicitly outstanding; daemon lease creates an execution row (`src/app/api/daemon/steps/next/route.ts:177`) and failure uses the shared finalizer (`src/app/api/daemon/steps/route.ts:208`). G3-1 skills consumption exists (`src/lib/server/dispatch.ts:225,281`); G3-2 CRUD and re-embedding exist (`src/app/api/skills/[id]/route.ts:41,81,89`). Preserve these completions; G3-3 transport and later gaps persist.

**Mode:** retain the recorded DELIVERY governance in `mode.md`. Prioritize a bounded HARDENING phase for existing behavior, with explicit DELIVERY stories for additions; this recommendation does not change mode.md or waive existing gates.

**Top five improvements:** (1) trustworthy local/CI evidence, (2) task/agent control semantics, (3) role and tool-permission enforcement, (4) MCP interoperability plus durable delivery, (5) safe upgrade and current daemon/deployment E2E. Sequence by dependencies and risks, not invented dates.

**Protect:** lease-first dispatch, shared failure finalization, budget/attempt records, workspace-filtered skill injection, credential indirection and existing ADRs. Next evaluation: after the first stabilization increment; refresh missing measurements then, before making release commitments.
