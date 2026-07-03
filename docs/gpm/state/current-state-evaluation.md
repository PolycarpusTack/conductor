# CURRENT STATE EVALUATION

Project:    Conductor (AgentBoard) — v0.4.0
Date:       2026-07-03
Evaluator:  Claude (brownfield baseline; 6 parallel review agents: backend/security, frontend, orchestration feasibility, quality/ops, functional completeness, UX journeys)

> This report substitutes for `current-state-evaluator-agent.md` per deployment-kit rule "reports replace their generators."
> Scope note: ~40k LOC hand-written TS (excl. generated Prisma client), 332 source files, 257 commits, solo developer.

---

## DIMENSION SCORES

### 1. CODE HEALTH — 5/10
```
Smell density:     MODERATE — concentrated in frontend (110-prop BoardView, 3,424-line help-page.tsx, ~98 scattered fetch())
Test coverage:     ~20% test-to-source LOC, 652 cases — trend ↑
Test quality:      STRONG (behavioural, security invariants asserted; bun:test + mock.module discipline)
TDD adherence:     PARTIAL (tests ship with features; core executor exempt)
Duplication:       MODERATE (readApiError re-implemented per hook; error parsing per call site)
Readability:       CLEAR in lib/server; MIXED in components
```
Top issues:
1. `dispatchStep` (src/lib/server/dispatch.ts:62-462, ~400 LOC) — the riskiest code, zero coverage → @agent-tdd-practitioner
2. Giant client components: help-page 3,424 LOC; 6 more >590 LOC → @agent-refactoring-catalog-advisor
3. 93 `any`-family annotations + 43 suppressions unguarded (lint rules disabled) → @agent-code-smell-detector

### 2. ARCHITECTURE HEALTH — 6/10
```
Dependency Rule:     Backend CLEAN (thin routes → lib/server); frontend N/A (single-route SPA)
Component cohesion:  HIGH backend / LOW frontend (BoardView god-component)
Component coupling:  APPROPRIATE backend; frontend prop-drilling coupling
ADR coverage:        ABSENT — no ADR anywhere (SQLite/PG duality, 3-plane auth, poll dispatch, WS split: all tribal)
Fitness functions:   2 active (type-check, stale-Prisma guard) / dep-rule, contract, perf checks missing
Integration patterns: DELIBERATE (internal-secret HTTP → Socket.IO; daemon pull protocol) but 2 auth conventions for same secret
```
Top issues:
1. Two parallel orchestration models (leased steps vs. unleased task-claims) with different guarantees → @agent-architecture-assessment-facilitator
2. SQLite/Postgres/pgvector duality under-constrained (provider hardcoded sqlite, vector via raw SQL) → @agent-evolutionary-architecture-advisor
3. In-memory per-process scheduler; single-instance constraint enforced nowhere, documented nowhere → @agent-architectural-decision-recorder

### 3. DOMAIN MODEL HEALTH — 5/10
```
Ubiquitous Language:   PARTIAL — vocabulary consistent in code (Task/TaskStep/Chain/Agent/Runtime/Daemon) but no glossary doc
Domain layer purity:   N/A by design — transaction-script style over Prisma (accepted for this architecture)
Anemic model:          YES (behaviour in lib/server modules, entities are rows) — acceptable, but invariants live only in app code
Aggregate boundaries:  UNCLEAR — free-string status columns (TaskStep, AgentSession, Host) with no DB/type enforcement
Bounded Contexts:      IMPLICIT — Model A (dispatch) vs Model B (claim API) share Task with different semantics
Core Domain focus:     NO — the core (daemon execution) is the least-built part; periphery is polished
```
Top issues:
1. Status state machines as unconstrained strings → @agent-building-block-classifier
2. Model A/B semantic split on Task undocumented → @agent-context-integration-advisor
3. Glossary absent → @agent-ubiquitous-language-guard (now deployed in .claude/agents/)

### 4. DELIVERY FLOW HEALTH — 6/10 (solo-adjusted; several sub-metrics UNKNOWN)
```
WIP:                 CONTROLLED (epic-arc commits, plan docs with checkboxes)
Cycle Time:          UNKNOWN — not measured. First action: track per-component CT (GPM §7)
Throughput:          ~257 commits over ~4 months, steady — trend →
Backlog health:      SHALLOW — plans exist per epic (docs/superpowers/plans) but no prioritised forward backlog
DoR enforced:        NO (no formal DoR)
DoD strength:        ADEQUATE informally (verify-then-commit + CI gate) — not written down
Unplanned work:      UNKNOWN
```
Top issues:
1. No forward backlog → fixed by development-plan-v1.md (this engagement)
2. No CT/rework measurement → @agent-flow-metrics-advisor
3. DoD implicit → adopt Core §3 Global DoD via mode.md

### 5. TECHNICAL DEBT HEALTH — 4/10
```
Debt visibility:       PARTIALLY — register exists but frozen at 2026-04-29 (Epics 1–4 only)
Debt register items:   14 listed; ≥1 wrongly open (TD-014 actually fixed in wizard-composer.ts:9-14,122); ~6 weeks of subsystems unregistered
Composition:           Code: moderate / Architecture: the expensive kind (duality, dual orchestration, frontend structure) / Infra: no Dockerfile
Recurring interest:    UNKNOWN (not tracked)
Past tipping point:    0 known
Credit Check:          Business alignment GREEN / Dev process YELLOW (lint gate off) / Architecture YELLOW (no owner doc/ADRs) / Team GREEN
```
Top issues:
1. Register stale + wrong → re-baseline (EPIC F) → @agent-technical-debt-classifier
2. Unused headline deps (TanStack Query, dnd-kit, next-intl, zustand) = silent architecture debt → @agent-technical-debt-strategist
3. ESLint disabled as a gate → @agent-pragmatic-programmer

### 6. OPERATIONAL READINESS — 5/10
```
Logging:              STRUCTURED (ActivityLog + OTel attributes) — strong for self-host class
Metrics:              BASIC+ (token/cost accounting, analytics dashboards; no golden-signal alerting)
Tracing:              YES (@vercel/otel wired)
SLOs:                 ABSENT
CI/CD:                CI FULL (validate, type-check, lint, test, doctor, standalone build); CD ABSENT
Deploy frequency:     MANUAL, multi-terminal (app + board-ws + daemons); no Dockerfile — compose covers DB only
Rollback mechanism:   NONE (no feature flags, no versioned deploys)
Circuit breakers:     PARTIAL (retries/backoff/dead-letter on dispatch; silent WS degradation is the anti-pattern)
Runbooks:             PARTIAL (doctor.ts + INSTALL.md §7; no incident runbooks)
```
Top issues:
1. No app container / turnkey deploy; POSIX-only start script on a Windows-developed repo
2. AGENTBOARD_WS_SECRET optional in prod → realtime silently dies (env.ts:24-25, realtime.ts:100-102)
3. No SLOs/alerting; board-ws has no health route consumed

### 7. PRODUCT VALUE HEALTH — 6/10
```
Vision:               CLEAR (agent orchestration with human gates) — walkthrough is honest about limits
Value measurement:    NONE (no usage telemetry, solo validation)
Feature usage rate:   UNKNOWN
EBM - Current Value:  YELLOW — HTTP-dispatch mode delivers; headline daemon mode does not (protocol without execution)
EBM - Time to Market: GREEN (steady release cadence 0.1→0.4)
EBM - Ability to Innovate: YELLOW (frontend structure will tax every future UI feature)
Validation loop:      ABSENT (no real users yet)
Mindset:              PRODUCT
Top wastes:           Partially done work (daemon layer; 4 unused deps), extra polish on periphery before core
```
Top issues:
1. Core promise (real agents on hosts) unimplemented while periphery is deep → @agent-core-domain-identifier
2. Money-spending product with no budget guardrail → product risk
3. Review gates/dead-letters can't notify a human → value leaks silently

---

## OVERALL: 5.3/10

## RECOMMENDED EXECUTION MODE
**DELIVERY** (architecture validated, feature development on it), with the daemon-execution EPIC run in **PROTOTYPE** until its tracer bullet passes. Recorded in `mode.md`.

## CRITICAL FINDINGS (address immediately — EPIC A/B of the plan)
1. Daemon execution layer absent — composed prompt never reaches the spawned CLI (mini-services/conductor-daemon/index.ts:180-192)
2. Dead pull-agents strand tasks forever — no task-claim lease/reaper (src/app/api/agent/tasks/[id]/route.ts:110-118)
3. Double-dispatch race — lease taken ~100 async lines late (src/lib/server/dispatch.ts:95-204); double LLM spend possible
4. Scoped API keys instance-wide; body-supplied projectId unchecked (src/app/api/tasks/route.ts:45-53)
5. No spend budgets/limits on a product that spends money autonomously
6. Silent failure modes: board load/switch, step actions, WS secret unset — user sees "empty," not "broken"

## TOP 5 IMPROVEMENTS (impact order)
1. Daemon tracer bullet (prompt → CLI → workspace → evidence) — converts the headline feature from aspirational to real
2. Engine correctness pass (lease-first, reaper, timeout reconciliation, dispatchStep tests) — trust in the core
3. Trust-UX pass (error/empty/loading states, toasts on silent catches, notifications, cost + dead-letters on board)
4. Product completeness (board search/filter, due dates, budgets, bulk ops)
5. Frontend structural refactor (routing, state mgmt, memoization, a11y, use-or-remove the 4 unused deps)

## STRENGTHS (protect these)
- Backend security discipline: hashed keys, timing-safe compares, per-project agent authz, CSRF/SSRF guards
- Chain/DAG engine: leases, idempotency keys, backoff, dead-letter, review-gate supersession — well tested
- CI pipeline + doctor.ts + env fail-fast; clean secret hygiene
- Observability suite, audit log + retention + export, template/library/wizard ecosystem
- Design-token foundation (op-* palette) and the task-detail drawer / DAG editor depth

NEXT EVALUATION: 2026-08-03 (monthly — active project)
