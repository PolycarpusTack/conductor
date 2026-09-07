# AgentBoard / Conductor — executable backlog

Planning baseline: 2026-09-07. Mode: **DELIVERY**. This is a brownfield replan, not an instruction to implement, approve architecture, change dependencies, or deploy. The [working GPM program](docs/gpm/state/working-program-2026-09-07.md) owns release sequencing beyond these first two EPICs; the [current-state review](docs/gpm/state/current-state-review-2026-09-07.md) owns evidence. Historical A–G and G0–G4 identifiers remain historical; this queue starts at H.

## Execution status — 2026-09-07

The user authorized starting this plan. **H-1 complete:** the missing-package
failure was specific to the managed Windows sandbox. The unchanged full suite
passes **906 tests / 0 failures** in the reviewed, credential-free host execution.
See [H-1 evidence](docs/gpm/state/evidence/H-1-T2-verification-restored.md).
**H-2 complete:** CI parity and disposable fixture safeguards; final suite
**925 tests / 0 failures**, types/lint pass, real fixture doctor has zero failures.
See [H-2 evidence](docs/gpm/state/evidence/H-2-verification.md).
**Next pull candidate: H-3-T1**, isolated daemon-tracer diagnosis.
Architecture and release gates for later tasks remain in force. The original
planning assessments below are historical pull inputs; this status owns progress.

## Readiness decision

**7/9: clarity 3, feasibility 2, completeness 2 — READY_FOR_PLANNING with scoped execution HOLDs.** The product, stack, personas and observed problems are concrete. The reproducibility defect is undiagnosed, the daemon tracer is unproven, and control/security compatibility decisions need records. Mitigation is diagnosis first, isolated fixtures, fail-closed safeguards, and explicit dependent-code holds. This score is not release approval.

**Original planning pull candidate was H-1-T1.** H-1/H-2 have since completed
under the user's execution instruction; use the execution status above to resume.
Later tasks retain their own pull gates and independent verification.

Critical gaps and gates:

| Gate | Missing decision/evidence | Ready independent work | Dependent work held |
|---|---|---|---|
| H-DIAG | Why installed modules resolve in Node but fail in Bun; supported runtime/install matrix | H-1-T1 reproduction/report | H-1-T2 repair and trustworthy suite verdict |
| I-CONTROL | Board versus execution semantics, durable operator intent versus presence, migration/compatibility lane | I-1 decision preparation; I-2 conservative no-schema safeguard after contract | Durable state, pause/resume and any cancel implementation |
| I-AUTH | Privileged role matrix, project binding/legacy-key transition, cookie trust boundary, reset-abuse limits | Inventory/proposed decisions; existing role-gate repair after recorded matrix | Key policy changes, request-protection implementation |
| I-MCP | Effective per-tool policy and old server/daemon capability handling | Contract proposal and negative fixtures | Runner/config changes until fail-closed compatibility is specified |
| LINUX | Accessible Linux build/container environment and safe upgrade procedure | Local fixture tracer and documentation | Production artifact/deploy certification; roadmap J |

## Domain glossary and assumptions

Use these terms consistently; do not rename existing wire values as part of this plan.

| Term | Meaning |
|---|---|
| Operator | Person configuring and controlling work in an instance. |
| Reviewer | Person accepting/rejecting a human review gate. |
| Project | Existing container for tasks, agents and configuration; not a newly promised tenant boundary. |
| Task | Board work item, optionally containing a Chain. Board status is currently stored independently of active steps. |
| TaskStep | Executable/review node with status, lease and retry state. |
| Chain | Existing ordered or DAG workflow of TaskSteps. |
| Agent | Configured worker; `isActive` currently conflates operator intent with activity/presence. |
| Daemon | Local worker process that polls the server and invokes a CLI in a mapped workspace. |
| Execution path | Server HTTP/LLM adapter, daemon CLI, or external agent pull/claim API. |
| Lease / Attempt | Lease grants temporary execution ownership; an Attempt is one recorded execution try. |
| Presence / Execution intent | Proposed distinct concepts: observed contact versus operator permission to start work. No new fields exist yet. |
| Pause / Cancel | Proposed controls. Pause prevents new claims/dispatch after the accepted boundary; it does not promise to kill a running process. Cancel remains undecided until late-result and fencing semantics are approved. |
| Scoped API key | Existing hashed credential carrying scopes and optional project binding; legacy instance-wide keys still exist. |
| Tracer bullet | A working thin path through API, database, dispatcher, daemon, real child process and persisted result. |

Synonyms to avoid: task = job; presence = enabled; Done = canceled; heartbeat = resume; project = tenant. WAITING and REVIEW remain actual distinct statuses until roadmap M resolves their UX meaning.

| Assumption | Impact / validation |
|---|---|
| Local-first, trusted-operator release is the initial target; shared Linux deployment is separately gated. | **High**: confirm in release contract; never treat shared-host readiness as proven. |
| Preserve SQLite, Node app/DB diagnostics and Bun tests/tooling; preserve three execution paths. | **High**: [ADR-0007](docs/adr/ADR-0007-node-runtime-bun-tooling.md); no cloud/provider/tenant redesign. |
| July daemon finalization/cost/skills work exists; September whole-suite and daemon E2E evidence supersede historical green counts. | Medium: revalidate changed contracts at pull; do not rebuild completed features. |
| No paid provider/SMTP/MCP account is required for these fixtures. | Medium: local fake CLI, mock HTTP/MCP/SMTP and synthetic accounts. |
| New state needs a safe migration lane; `db push --accept-data-loss` is not that lane for existing data. | **High**: roadmap J provides or approves the lane before I-3 schema work. |
| Numeric thresholds below are proposed acceptance targets, not measured performance or availability claims. | Medium: capture machine/runtime/fixture data and revise through recorded evidence. |

STRIDE: **S** stolen/overprivileged credentials → existing role/scope gates and fixture tests. **T** forged control/completion/config → origin checks, ownership/fencing contract, strict allowlists. **R** ambiguous actions → actor/action/result correlation without secrets. **I** token/prompt leakage → redact payloads/logs, project-scoped fixtures. **D** reset floods/stuck leases → bounded throttling and measured queue signals. **E** member key issuance/MCP wildcard → fail-closed policy and negative tests. No compliance regime specified; this is not a compliance certification.

Data/DPIA-lite: fixture names/emails are synthetic; workspace paths and run IDs are internal; user emails, prompts, outputs and production diagnostic logs are confidential; tokens/passwords are restricted. No production customer records, tokens or mail delivery in tests. Dedicated fixture DB/workspace are removed on successful teardown; failed-run diagnostics are sanitized and proposed to expire after 7 days. Keep only aggregate timings and redacted verdict evidence longer. I-1 records whether proposed abuse counters contain IP/account-derived personal data and their minimum retention (proposal: window plus one cleanup interval, at most 24 hours). Production retention changes require their own decision; this plan does not silently alter them.

## Shared execution contract

This section supplies defaults to **every task row** below; row overrides win. Output/size caps are explicit: R or X task ≤12,000 output tokens, ≤1,200 changed LOC and ≤3 complex modules; V task ≤3,000 output tokens, **0 authored code/document LOC**, ≤3 inspected complex modules per pass. Any task forecast above a cap stops for decomposition before edits. Each prompt loads current architecture memory, at most three relevant snapshots, the task and DoD (target ≤3,000 context tokens). R = reasoning/design; X = execution/generation, including docs; V = verification/verdict only. These are provider-neutral capability tiers, not fixed model brands.

Every task has one Hat. FEATURE changes behavior; PREPARATORY researches, builds verification scaffolding or authors handoffs. Structural refactoring, if needed, becomes a separate REFACTORING task; no opportunistic cleanup. Confidence defaults Medium=2; evidence can raise it. Use the collection's backlog builder/critic for planning and task-appropriate execution specialists from the GPM program. WIP=1; arrows specify dependency order, not dates. Different roots may be reprioritized only with a recorded pull decision.

**TDD/order:** before behavior changes, write the relevant failing happy/error/edge regression, demonstrate the failure, then minimal implementation, then a separate refactoring task only if justified. Preparatory report tasks define a reproduction/evidence checklist first, collect evidence second, write findings third; they do not manufacture tests that mirror documentation. V executes/checks existing evidence and returns a verdict; X authors the resulting docs. Reuse existing fixtures, `dbMock`, finalizer, logger, OpenTelemetry and auth helpers; apply Rule of Three within a bounded context and preserve inward dependencies.

**All pull gates additionally require:** predecessor deliverables and current source/snapshot agree; story DoR or specifically permitted spike is satisfied; isolated environment exists; caps fit; no unresolved high-impact decision is crossed; and the current execution instruction authorizes that work. Contract producers publish versioned snapshots containing actual signatures, error/status shapes, dependencies and glossary terms. Names marked **NEW** are planned files, not existing interfaces. Update snapshots after code acceptance, not before as facts.

**All quality gates additionally require:** appropriate five-layer checks below, ≥80% coverage of new logic, no new lint/type errors, no secret leakage, boundary/dependency check for changed modules, reproducible red/green evidence, integration note, and visible debt. Existing warnings are explicitly dispositioned. No fixed historical pass count (including 855) is an acceptance target; no silent skipping/quarantining to obtain green. Security corrections have no permissive rollback toggle. Default flags: N/A for preparatory/internal changes; UI-specific flags declared below. No schema migration by default. Rollback: revert isolated fixture/docs changes; production repairs revert only to a demonstrated safe version or disable the affected capability, never reopen unsafe access. Every new shortcut gets a debt record before handoff.

**Five verification layers:** unit (new decision logic and ≥80% new-logic coverage), consumer/provider contract (daemon payload/result, mock CLI/MCP/SMTP), integration/API (real disposable SQLite under Node, authorization and races), E2E smoke (browser/API → daemon child → persistence; explicit failed verdict on missing prerequisites), performance (numeric targets under pinned local workload). Negative/security tests are mandatory where applicable; a layer with no changed surface is justified N/A, not counted as a pass. Existing tracing carries W3C context; add bounded spans/log fields only where missing, using the existing stack. Capture latency, traffic, errors and saturation (leased/queued steps, child concurrency); never install a new telemetry platform for this backlog.

## Dependency policy and readiness

Task arrows name **mandatory data/contract dependencies**, not an artificial total order. H is sequential. After H, I-1 prepares independent decision slices; I-1-T3 can issue a verdict for one complete slice while another remains HOLD. WIP stays one, but the operator may pull any eligible branch without waiving its own gate:

- I-2-T1 needs the conservative-control slice; no migration required.
- I-3-T1 needs the durable-control slice **and** accepted J local migration evidence if new schema is chosen; I-3-T2 → I-3-T3 remain dependent.
- I-4-T1 needs the existing-role matrix; I-4-T2 additionally needs legacy/binding/replay decisions and J only if its chosen change needs schema.
- I-5-T1 → I-5-T2 need their own request/reset contracts, not I-4 legacy completion.
- I-6-T1 → I-6-T2 need their own tool-policy/compatibility contract, not I-3/I-4/I-5 completion.
- I-6-T3/T4 are the acceptance join: all release-required branch evidence is required. A partial verification report may be authored while a branch is held, but it cannot mark the epic or release accepted.

Recommended scheduling after the decisions is the no-schema control safeguard, key role enforcement, cookie/reset safeguards and daemon tool permissions; durable state waits for its migration lane. J local migration preparation has no dependency on I completion. A HOLD in one decision slice never masquerades as a prerequisite for unrelated security repairs.

## EPIC H — reproducible verification and working daemon tracer

**Objective / value:** restore dependable feedback and prove one operator's workflow actually completes. **Tracer bullet: YES. Mode: DELIVERY.** Success target: every required fixture scenario returns an explicit verdict with persisted evidence; no silently skipped check. Architecture reference: [current architecture memory](docs/gpm/state/architecture-memory.md), reconciled with the September baseline; update it at H completion. ADRs: existing 0007/0008; **NEW proposed** `docs/adr/ADR-H-verification-contract.md`. Glossary: Task, TaskStep, Lease, Attempt, Daemon, Tracer bullet. Runbook: extend [daemon-step-stuck](docs/ops/runbooks/daemon-step-stuck.md), plus **NEW** `docs/ops/runbooks/verification-recovery.md`. Smoke story: H-3; H-4 records operating handoff.

Risk: High false confidence → no waived failures, separate artifact/deployment gate; Medium fixture pollution → isolated DB/workspace and teardown proof; Medium nondeterministic timing → fixed runner scenario, controllable clock where appropriate, retain sanitized failure logs. Review risks at each pull and H retro; owner: operator/reviewer until assigned. Proposed SLOs: `Local fixture tracer – p95 completion < 300 seconds over 5 sequential cold-start runs`; `Completion processing – duplicate persisted attempts = 0 over 100 replayed reports`; `Verification – unclassified required-check failures = 0 per accepted H run`. These are fixture objectives, not production SLAs.

EPIC DoD (in addition to shared DoD):

- Supported-script suite, type-check, lint and offline doctor produce current reproducible verdicts; failure causes and environment are recorded.
- H-3 proves success, retry and terminal-failure flows through a real CLI child with output/attempt/cost/dead-letter assertions and clean teardown; required checks cannot skip to success.
- Smoke/runbooks, snapshots, architecture update and phase summary are reviewed; Linux production artifact and migration readiness are separately labeled PASS/HOLD with evidence.

### H-1 — diagnose and repair reproducibility

As the **maintainer**, I want a reproducible test entrypoint so that a failure indicates actionable evidence rather than an unknown environment effect. Value 3; priority 5/5; size M. Priority scores throughout are a normalized judgment combining value, dependency/SLO impact and delivery risk, not a date forecast.

```gherkin
Scenario: Reproduce the supported checks
  Given the recorded checkout and installed runtimes
  When the documented commands are repeated in isolation
  Then the report identifies commands, versions, module resolution and exact verdicts
Scenario: An apparent repair does not address the cause
  Given an unexplained Bun module-resolution failure
  When a repair is proposed without discriminating evidence
  Then implementation remains held and the unresolved hypotheses are recorded
Scenario: Node and Bun disagree
  Given the same installed mustache and OpenTelemetry packages
  When each runtime resolves/imports them
  Then differences are captured without labeling all failing tests product defects
```

Sources/contracts actual: [package scripts](package.json), [ADR-0007](docs/adr/ADR-0007-node-runtime-bun-tooling.md), `src/lib/server/__tests__/db-mock.ts`. Baseline supplied: Bun 1.3.13, 604 pass/43 fail/27 errors; isolated project tests fail resolving `mustache`; Node resolves installed packages. Cause **unknown**. External dependencies: installed runtimes available; clean install/network only if required later and authorized. Fixtures: no production DB; sanitized minimal imports. Idempotency: run ID separates logs; report overwrite/version is explicit, no production writes. Debt: BH-01 below. Security/flags: no secrets, N/A. **DoR: HOLD for repair; preparatory T1 READY.** INVEST I✓ N✓ V✓ E✓ S✓ T✓ for diagnosis; repair estimability conditional on report.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| H-1-T1 | PREPARATORY / R | SPIKE: discriminate install, runtime, alias and mock-leak hypotheses. Checklist → exact reproduction → bounded recommendation. Report only; no dependency/lockfile/product changes. **NEW** `docs/gpm/state/evidence/H-1-T1-verification-diagnosis.md` only. The actual verification-entrypoints snapshot is produced by H-1-T2 after repair acceptance. Inspect at most 3 failing entrypoint/import clusters; stop with next experiment if unresolved. | Baseline and installed state readable; run commands only against disposable/no-DB context → H-1-T2 |
| H-1-T2 | FEATURE / X | Repair only the evidence-established harness/toolchain defect; failing regression → minimal fix → actual entrypoint snapshot and integration note. Preserve lockfile unless deliberate supported-version change is approved in ADR-H. Do not broadly upgrade or suppress failures. Rollback to known safe verification setup; keep unresolved product failures visible. | **HOLD:** H-1-T1 identifies mechanism, minimal change and supported matrix; if production code implicated, refine a separate bounded fix first → H-2-T1; END H-1 |

### H-2 — align CI and isolated checks

As the **maintainer**, I want local and CI checks to invoke the same supported scripts so that merge evidence can be repeated. Value 3; priority 5/5; size M.

```gherkin
Scenario: Run supported entrypoints
  Given H-1's accepted runtime matrix and a fresh fixture database
  When CI runs validation
  Then tests use the package test script and doctor runs via its Node-backed script
Scenario: Environment or required check is missing
  Given an unavailable required runtime or invalid fixture database
  When validation starts
  Then it fails explicitly before reporting successful application checks
Scenario: Existing data is configured accidentally
  Given DATABASE_URL points outside the disposable test location
  When fixture preparation runs
  Then destructive schema setup is refused and existing data is untouched
```

Sources: [.github/workflows/ci.yml](.github/workflows/ci.yml), package scripts, doctor. Actual CI uses raw `bun test`, raw Bun doctor and `db push --accept-data-loss`; no safe upgrade is inferred from disposable schema setup. Contracts NEW: `snapshots/verification-entrypoints.md` finalized and `snapshots/test-isolation.md`. Deps: H-1; Linux hosted CI availability unverified until execution. Fixtures: unique SQLite file, local env, fake credentials, scoped temp directory. Idempotency: fixture run ID; repeated cleanup only within resolved owned path; refuse collisions. Debt BH-01. Flags N/A; no schema change to user data. **DoR HOLD until H-1 repair verdict**; INVEST I✓ N✓ V✓ E✓ S✓ T✓ conditional on that contract.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| H-2-T1 | PREPARATORY / X | Entrypoint/isolation negative checks → workflow/script changes → snapshots. Pin the supported matrix from H-1; test setup uses a disposable DB, not an upgrade mechanism. Ensure `verify`/build expectations distinguish standalone packaging from raw Next compilation. Max 3 complex modules: script orchestration, fixture setup, CI adapter. | H-1-T2 accepted; proposed isolation contract reviewed → H-2-T2 |
| H-2-T2 | PREPARATORY / V | Return verdict on local command parity, no leaked live env, cleanup and CI configuration; inspect existing outputs or execute authorized checks. No authored snapshots or claimed remote CI run without a run URL/result. | H-2-T1 evidence ready → H-3-T1; END H-2 |

### H-3 — prove daemon execution through a real child process

As the **operator**, I want a spend-free workflow smoke so that task completion means the worker executed and the server recorded its result. Value 3; priority 5/5; size M.

```gherkin
Scenario: Complete a fixture step
  Given a disposable project, daemon, mapped workspace and fake CLI
  When the server leases a step and the daemon invokes the child
  Then output, session evidence, one attempt and synthetic cost are persisted
Scenario: Retry then exhaust a failure
  Given deterministic retry and always-fail CLI scenarios
  When the daemon reports failures
  Then server policy controls attempts/backoff and exhaustion creates one dead-letter record
Scenario: Replay or lose a report
  Given an already finalized attempt or an interrupted child
  When reports are replayed or the smoke deadline expires
  Then attempts/costs are not duplicated and a stuck execution is an explicit failed verdict
```

Sources actual: [doctor tracer](scripts/doctor.ts), `scripts/daemon-e2e-fixture.ts`, [daemon payload v2](docs/gpm/state/snapshots/daemon-execution-payload.md), [ADR-0008](docs/adr/ADR-0008-server-authoritative-daemon-retry.md), `src/app/api/daemon/steps/route.ts`, `mini-services/conductor-daemon/index.ts`. Do not invent already-fixed bookkeeping as new work. Deps: H-2; fake executable/ports available at pull; Linux if local environment proves unsuitable, never a silent skip. Fixtures: success, fail-once, exhausted, duplicate, timeout; synthetic cost metadata with no paid call. Idempotency: assert existing step/attempt ownership identity and replay behavior; missing server guarantee becomes a separately bounded corrective task. Debt BH-02. Flags N/A; fixture controls cannot enable production debug credentials. **DoR HOLD until H-2 evidence**, INVEST I✓ N✓ V✓ E✓ S✓ T✓; unknown daemon cause gets a bounded diagnostic task first.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| H-3-T1 | PREPARATORY / R | Trace historical stuck-step symptom with sanitized server/daemon logs; produce exact last-success boundary, failure reproduction and minimal repair proposal. **NEW** `spike-H-3-daemon-tracer.md`; no speculative engine rewrite. | H-2-T2 accepted, payload v2 matches code, isolated smoke available → H-3-T2 |
| H-3-T2 | FEATURE / X | Failing stuck-step regression → identified run-loop/fixture correction → real-child success smoke. Scope at most daemon loop, runner and smoke orchestrator; if root cause lies elsewhere, refine before execution. Preserve finalized retry/cost contracts. Publish **NEW** `snapshots/daemon-tracer.md`. | **HOLD:** H-3-T1 demonstrates cause and accepted bounded repair; required process available → H-3-T3 |
| H-3-T3 | PREPARATORY / X | Add/extend deterministic retry/exhaustion/replay/cost fixtures and five-layer evidence matrix; assert actual server finalization without mocking away dispatch/child boundaries in E2E. Fixture failures cannot be warnings. If new product defect appears, stop and split repair. | H-3-T2 successful whole-path evidence → H-3-T4 |
| H-3-T4 | PREPARATORY / V | Return success/error/edge and proposed SLO verdicts, cleanup and redaction findings. Performance sample may not be represented as production availability. | H-3-T3 evidence and supported environment → H-4-T1; END H-3 |

### H-4 — make verification and recovery operable

As the **maintainer**, I want a reviewed smoke/recovery handoff so that another session can diagnose a stuck task without rerunning unsafe setup. Value 2; priority 4/5; size S.

```gherkin
Scenario: Follow the runbook
  Given H-3's accepted evidence
  When a maintainer follows the exact supported commands
  Then the same success and controlled-failure verdicts can be obtained
Scenario: Production prerequisites are absent
  Given no validated Linux artifact or safe migration lane
  When release evidence is summarized
  Then production deployment remains HOLD with the missing prerequisite named
Scenario: A diagnostic contains sensitive output
  Given a failed fixture run
  When logs are retained for diagnosis
  Then credentials/content are redacted and the retention/cleanup instruction is explicit
```

Contracts: H snapshots; existing logger/tracing and daemon runbook. Deps H-3; actual Linux access checked and recorded, no Docker claim inferred from history. Fixture: runbook replay using synthetic records. Idempotency: versioned docs; no live restart/reset/rotation. Debt BH-02/03. Flags N/A. **DoR HOLD until H-3 verdict**; INVEST I✓ N✓ V✓ E✓ S✓ T✓.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| H-4-T1 | PREPARATORY / X | Author runbooks, plain-language integration note, phase summary and corrected architecture memory. Include golden signals/correlation IDs, symptoms→checks→safe containment, exact smoke command, sanitized log paths, retention and rollback. Separate local tracer PASS from Linux artifact HOLD. Max 0 complex production modules. | H-3-T4 verdict available → H-4-T2 |
| H-4-T2 | PREPARATORY / V | Return fresh EPIC DoD/contract/runbook verdict and list unresolved debt; no documentation authorship. | H-4-T1 handoff complete → I-1-T1; END H |

## EPIC I — execution and access safety

**Objective / value:** operator controls and access policy must govern what actually executes. **Tracer bullet: NO. Mode: DELIVERY.** Root story I-1 follows H's checkpoint; no intra-EPIC dependency on a later story. Architecture reference: H-updated memory plus September baseline. Existing ADRs 0002/0005/0007/0008; **NEW proposed** `docs/adr/ADR-I-control-contract.md`, `ADR-I-access-policy.md`, `ADR-I-daemon-tool-policy.md`. Glossary: Task, Agent, Presence, Execution intent, Lease, Pause, Cancel, Scoped API key. Smoke: I-6-T3 covers I's accepted scope; runbook **NEW** `docs/ops/runbooks/execution-access-safety.md`.

High risks: late writes after pause/cancel; privileged access downgrade; destructive state conversion. Mitigate via explicit boundaries/fencing, fail-closed capability isolation, copy-based migration rehearsal and code HOLDs. Medium risks: existing client compatibility and overbroad throttling; mitigate by protocol matrix and synthetic good-client tests. Review at I-1 decision and every dependent pull; owner operator/reviewer until assigned. Proposed SLOs: `Control API – p95 acknowledgement < 500 ms over 1,000 local requests at concurrency 5`; `Execution policy – unauthorized new claims = 0 over 200 concurrent pause/claim races`; `Access policy – unauthorized accepted actions = 0 over the role/origin/tool negative-test matrix`. Exclude child run duration from acknowledgement latency. Emit action/actor/decision, trace IDs, latency, request counts, denials, leased/queued saturation using existing stack.

EPIC DoD:

- Accepted controls/presence scope passes unit, contract, API, browser/daemon smoke and proposed race/performance objectives; every unimplemented control is visibly unavailable and documented.
- Credential, cookie/reset and daemon-tool policies pass negative/compatibility tests; rollback cannot restore unsafe permissions; any new schema has an accepted migration/restore rehearsal.
- Operator runbook, approved snapshots, decision records, phase summary and debt disposition are reviewed; retained HOLDs prevent the associated release claim.

### I-1 — decide bounded control and access contracts

As the **operator**, I want explicit control and access rules so that implementation does not invent what pause, cancel or administrator mean. Value 3; priority 5/5; size M.

```gherkin
Scenario: Record a decision
  Given existing task, claim, lease and authentication contracts
  When concrete options are reviewed
  Then the selected contract records transitions, races, role boundaries and compatibility
Scenario: A high-impact choice is undecided
  Given no approved migration or late-completion policy
  When downstream execution is considered
  Then dependent code remains HOLD and the no-schema safeguard is considered separately
Scenario: An older client connects
  Given a server/daemon or key-policy version mismatch
  When the contract is applied
  Then it specifies a safe compatibility path or explicit refusal without wider permissions
```

Source contract actual: task PUT, `step-queue.ts`, `src/app/api/agent/next/route.ts`, `src/lib/server/admin-session.ts`, `src/lib/csrf.ts`, daemon snapshot. NEW snapshots: `task-controls.md`, `agent-intent-presence.md`, `access-policy.md`, `daemon-tool-policy.md` in `docs/gpm/state/snapshots/`. Deps H checkpoint; decisions available only after review. Fixtures: transition table, role/client matrix and threat cases; no production writes. Idempotency: future commands keyed by target + expected state/revision or operation ID, exact choice recorded here; duplicate cancel/retry cannot reset completed attempts. Debt BI-01/02/03. Flags N/A. **DoR READY for decision preparation after H; code decisions not preapproved.** INVEST I✓ N✓ V✓ E✓ S✓ T✓ for spike.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-1-T1 | PREPARATORY / R | Compare (a) reject misleading status drags only, (b) durable task pause/resume preventing new work, (c) cancel with terminal-state/fencing protocol. Recommend staged a→b; do not imply process kill. Define already-running completion, retry/reclaim and external pull-claim behavior. Separately choose agent intent/presence mapping, old `isActive` writes, backfill and restore. Author proposed ADR-I-control and snapshots; ≤3 conceptual stateful modules. | H checkpoint + current source; no schema/code changes → I-1-T2 |
| I-1-T2 | PREPARATORY / R | Propose existing-role matrix (member/admin/owner), scoped-key project binding/legacy-key transition, cookie-only origin/token policy including trusted proxy/canonical scheme, and reset limits/retention. Compare explicit MCP tool intersection (connection scope ∩ mode allowlist ∩ runner capability), version negotiation and old-client refusal. Publish proposed ADR-I-access/tool and snapshots. Split if >3 complex policy modules. | I-1-T1 state boundary recorded; privilege inventory current → I-1-T3 |
| I-1-T3 | PREPARATORY / V | Return decision-completeness/STRIDE/DoR verdict, distinguishing reviewer-approved contracts from proposals. Verdict cannot itself grant architecture approval. | Relevant I-1-T2 decision slice ready; record a separate completeness verdict and owner selection for each slice → I-2-T1, I-3-T1, I-4-T1, I-5-T1, I-6-T1 subject to their own slice gates; END I-1 |

### I-2 — reject dishonest chained-task board moves

As the **operator**, I want unsupported board moves rejected so that Done or Backlog does not imply an active chain stopped. Value 3; priority 5/5; size S.

```gherkin
Scenario: Move an ordinary task
  Given a task without active workflow steps
  When an allowed board transition is requested
  Then existing task behavior is preserved
Scenario: Misrepresent a running chain
  Given an active chained task
  When an unsupported terminal/backlog drag is requested
  Then the server rejects it with the approved conflict error and the UI explains the actual state
Scenario: State changes during a drag
  Given a stale board card and a newly active step
  When the mutation arrives
  Then the server rechecks execution state and no misleading success/event is emitted
```

Sources actual: [task PUT](src/app/api/tasks/[id]/route.ts), [dispatch selection](src/lib/server/step-queue.ts), task batch/status entrypoints discovered at pull. NEW contract task-controls: exact allowed transition/error matrix approved in I-1; no new API path assumed. Deps I-1 conservative slice; **no schema lane required**. Fixtures: unchained, active chain, stale card, batch edit. Idempotency: expected current state checked atomically; duplicate rejection has no write/event. Risk High → mandatory server guard; UI flag **NEW** `NEXT_PUBLIC_TASK_CONTROL_EXPLANATIONS=false` only hides explanatory UI, never the guard. Rollback disable unsafe transition route if needed. Debt BI-01. **DoR HOLD until conservative contract accepted**; INVEST I✓ N✓ V✓ E✓ S✓ T✓ conditional.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-2-T1 | FEATURE / X | Failing transition/race tests → no-schema invariant guard in all existing status-write paths → API/browser feedback and actual snapshot. Keep bound ≤3 complex modules; inventory any extra writer and split a dependent task before claiming coverage. | I-1-T3 + approved no-schema matrix; auth boundary unchanged → I-3-T1; END I-2 |

### I-3 — preserve durable execution intent

As the **operator**, I want pause to survive heartbeat and concurrent polling so that new work starts only when I permit it. Value 3; priority 5/5; size M **only for approved pause/resume scope**.

```gherkin
Scenario: Preserve agent pause
  Given execution intent is paused
  When the agent or daemon heartbeats and reconnects
  Then presence updates without enabling new claims or dispatch
Scenario: Refuse an unsafe upgrade
  Given persisted intent cannot be mapped safely or a legacy client cannot honor the policy
  When rollout starts
  Then execution stays disabled for that capability with an actionable compatibility error
Scenario: Pause races a claim and completion
  Given concurrent pause, lease acquisition and an already-running attempt
  When operations commit
  Then no new lease crosses the accepted pause boundary and the accepted late-result contract is followed
```

Sources: Agent/Task/TaskStep in [schema](prisma/schema.prisma), agent heartbeat/poll writers, task/step dispatch and claim routes. Contracts NEW task-controls/agent-intent-presence: exact fields, error shapes, migration and command idempotency are decision outputs, not facts. Deps I-2 and **roadmap J safe migration lane**. Fixtures: copied synthetic old-schema DB, old/new clients, server HTTP mock, daemon child, external agent client, fake clock. Idempotency: target+expected revision/operation identity chosen by ADR, atomic claim predicate, completion fenced by accepted ownership; duplicates do not reactivate. Risk High; flags **NEW** `TASK_PAUSE_CONTROLS=false` and `AGENT_INTENT_STATE=false` gate UI/new representation only; missing/ambiguous intent must fail closed. Disabling flags cannot reopen claims for paused agents. Rollback stops dispatch, uses accepted compatible restore/forward repair, then smoke. Debt BI-01. **DoR HOLD: contract, migration lane and bounded task scope missing.** INVEST I✓ N✓ V✓ E✗ S✓ T✓. **Cancel implementation is HOLD and must be decomposed after approval of terminal state, late completion and daemon fencing; this story does not silently deliver cancel.**

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-3-T1 | FEATURE / X | Migration/compatibility tests first → additive intent representation and audited mapping → copy-based upgrade/restore evidence + versioned snapshot. No destructive `db push`, no inferred backfill of ambiguous operator intent. Max 3 modules: state model, persistence, compatibility mapper. | **HOLD:** approved ADR-I-control and J migration lane, validated synthetic backup/restore → I-3-T2 |
| I-3-T2 | FEATURE / X | Heartbeat/presence and concurrent eligibility tests → preserve operator intent across agent writes and claim/dispatch predicates → actual policy snapshot. Cover all three paths via adapters; split if >3 complex modules. | I-3-T1 accepted migration/compatibility evidence → I-3-T3 |
| I-3-T3 | FEATURE / X | Pause/resume API and browser/race regressions → approved control mutation and honest UI → snapshot/flag/rollback evidence. Existing running processes follow approved completion policy; no kill/cancel promise. | I-3-T2; exact command wire contract and pause boundary approved → I-6-T3 after other in-scope branches; END I-3 |

### I-4 — enforce credential administration and project scope

As an **instance administrator**, I want key management restricted by role and project policy so that members cannot grant unintended access. Value 3; priority 5/5; size M.

```gherkin
Scenario: Manage an authorized key
  Given an administrator and a permitted project-bound key request
  When the key is issued, listed or revoked
  Then the role/scope contract is enforced and raw key material is returned only at issuance
Scenario: Member attempts privilege escalation
  Given a member or unauthenticated caller
  When key administration is requested
  Then it returns the approved 403 or 401 without changing key state
Scenario: Legacy or cross-project access
  Given an instance-wide legacy key or a key bound to another project
  When an action is attempted
  Then the approved compatibility policy applies and cross-project privilege is never inferred
```

Sources: [key routes](src/app/api/admin/api-keys/route.ts), `requireRole` in admin-session, `scoped-api-keys.ts`. Actual: `requireAdminSession` authenticates members too; existing `requireRole` supports admin/owner. NEW access-policy snapshot must specify matrix and legacy treatment. Deps H checkpoint and the relevant I-1 access decision/verdict only. I-3 is not a mandatory predecessor; role enforcement does not wait for migration or legacy-key sunset. Fixtures: owner/admin/member/inactive/no-session, two synthetic projects, bound/legacy/revoked keys. Idempotency: revoke by immutable key ID; retrying issuance must not silently issue multiple secrets—record existing behavior or approved request-key conflict policy. No production key rotation. Risk High; no permissive flag; rollback disables key management/unsafe legacy capability, retains secure gate. Debt BI-02. **DoR HOLD until role matrix; legacy change separately held until policy.** INVEST I✓ N✓ V✓ E✓ S✓ T✓ conditional.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-4-T1 | FEATURE / X | Role-denial regressions → reuse existing requireRole for privileged key operations and consistent UI feedback → actual role snapshot. No broad replacement of session checks on ordinary routes. UI-only **NEW** `NEXT_PUBLIC_KEY_ROLE_FEEDBACK=false`; enforcement always on. | H checkpoint + I-1-T3 access-matrix verdict + recorded relevant contract; no I-3 or legacy-policy completion required → I-4-T2 |
| I-4-T2 | FEATURE / X | Project/legacy/replay contract tests → approved key-binding transition and safe denial behavior → compatibility/runbook evidence. Keep old-key migration separate from raw-key rotation; fail closed when scope cannot be established. | **HOLD:** I-4-T1 plus approved project/legacy and issuance-retry policy; any schema needs J lane → I-6-T3 after other in-scope branches; END I-4 |

### I-5 — protect cookie mutations and password-reset capacity

As an **instance administrator**, I want authenticated mutations and reset requests protected so that browser requests cannot bypass request checks and repeated resets do not exhaust the service. Value 3; priority 5/5; size M.

```gherkin
Scenario: Accept legitimate clients
  Given an approved same-origin cookie request or independently authenticated API-key client
  When its permitted mutation is sent
  Then the correct request-protection path applies without conflating auth planes
Scenario: Reject untrusted request context
  Given a cookie mutation with missing, null, forged or mismatched required origin context
  When protection runs
  Then it fails according to the approved origin/token contract before any mutation
Scenario: Bound resets without enumeration
  Given repeated requests for known and unknown synthetic accounts
  When the approved limit is exceeded or SMTP fails
  Then resource use is bounded and externally visible behavior does not reveal account existence
```

Sources actual: [csrf](src/lib/csrf.ts), `src/app/api/auth/reset/request/route.ts`, `confirm/route.ts`, password-reset service and existing limiter. Current guard permits missing Origin/Host and compares host, not scheme. NEW access-policy must distinguish cookie, bearer and unauthenticated reset routes, trusted proxy setup and canonical reset-link origin. Deps H checkpoint and the relevant I-1 request-policy decision/verdict only; I-4 legacy migration is independent. Fixtures: origins/schemes/proxy spoofing, no-Origin bearer client, mock SMTP, known/unknown/inactive accounts, expired/replayed reset token, controlled clock. Proposed reset ceiling: 5 account requests/15 minutes plus 20 client requests/15 minutes, subject to ADR refinement; no unconditional IP trust. Idempotency: one-use token remains one-use; suppression window prevents repeated mail issuance; retries never bypass limits. Risk High; no insecure toggle/rollback; disable reset sending or affected cookie mutations if necessary. Debt BI-02. **DoR HOLD until origin/client/limit/retention contract accepted**, INVEST I✓ N✓ V✓ E✓ S✓ T✓ conditional.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-5-T1 | FEATURE / X | Cookie/bearer/origin negative tests → approved guard and caller integration → actual request-policy snapshot. Inventory mutation coverage; do not block all server clients by assuming every request uses cookies. Max 3 complex modules; split route batches if needed. | H checkpoint + I-1-T3 request-policy verdict + approved request contract; no I-4 completion required → I-5-T2 |
| I-5-T2 | FEATURE / X | Reset abuse/enumeration/replay/SMTP-failure tests → bounded existing-limiter integration and canonical-link policy → retention/operating evidence. Do not change auth provider or send real mail. | I-5-T1; approved limits/proxy/retention and fixture clock available → I-6-T3 after other in-scope branches; END I-5 |

### I-6 — enforce daemon MCP tool restrictions and verify I

As the **operator**, I want the daemon to honor configured tool restrictions so that attaching an MCP server does not grant every tool on it. Value 3; priority 5/5; size M.

```gherkin
Scenario: Invoke an allowed tool
  Given compatible server/daemon versions and a tool allowed by connection, mode and runner policy
  When the fake CLI is spawned
  Then only the effective explicit tool set is supplied and the allowed fixture call succeeds
Scenario: Deny unsafe configuration
  Given a denied tool, malformed policy or unsupported enforcing runner
  When execution is prepared
  Then the step fails clearly before spawn or invocation rather than widening permissions
Scenario: Handle old clients and name collisions
  Given an old daemon or sanitized MCP server names that collide
  When configuration is resolved
  Then policy remains bound to the correct connection and incompatible execution is refused safely
```

Sources: [daemon config](src/lib/server/daemon-mcp-config.ts), [runner](mini-services/conductor-daemon/runner.ts), [next payload](src/app/api/daemon/steps/next/route.ts), actual payload v2. Current config selects no scopes/mode allowlist and runner grants `mcp__server__*`; that is evidence, not the desired contract. NEW daemon-tool-policy snapshot specifies effective policy/error/capability/version behavior. HTTP MCP transport repair belongs to roadmap K. Deps H checkpoint and relevant I-1 tool-policy decision/verdict only; local fake CLI/MCP available without credentials. Fixtures: two tools allowed/denied, connection scopes=[] denies all, null legacy scope, mode restriction including empty mode list, unknown policy, old client, colliding names, absent env reference, unsupported generic runner. Actual HTTP behavior distinguishes connection scopes=[] (deny-all) from null (unrestricted legacy); an empty mode allowlist currently bypasses additional narrowing. I-1 must record whether that mode behavior is preserved or migrated, never silently reinterpret it. Idempotency: config is deterministic for connection+policy revision+step mode; permission retries cannot broaden grants or duplicate attempts. Risk High; security enforcement always on, rollback disables MCP-enabled daemon execution or requires supported daemon. Never return to wildcard grants. Debt BI-03. **DoR HOLD until policy/protocol compatibility accepted**, INVEST I✓ N✓ V✓ E✓ S✓ T✓ conditional.

| Task | Hat / Tier | Goal, contract and deliverables | Pull gate → Unblocks |
|---|---|---|---|
| I-6-T1 | FEATURE / X | Consumer/provider negative contracts → server policy payload and version/capability guard → actual daemon-tool snapshot. Keep secrets as env-name indirection; invalid/missing policy fails closed. Max 3 modules: resolver, payload, capability guard. | H checkpoint + I-1-T3 tool-policy verdict + approved compatibility contract; no I-3/I-4/I-5 completion required → I-6-T2 |
| I-6-T2 | FEATURE / X | Fake-CLI allow/deny/spawn tests → exact permission argv/config enforcement → paired daemon/server contract evidence. Unsupported runner refuses promised MCP tools; no MCP wildcard fallback. Max runner/validator/config-file adapter. | I-6-T1 actual snapshot accepted → I-6-T3 |
| I-6-T3 | PREPARATORY / X | Author browser/API+daemon safety smoke for accepted I controls, role/origin/reset/MCP denial matrix and performance/race samples. Extend existing fixtures/telemetry; publish runbook, phase summary, architecture updates and debt decisions. Held cancel/schema scope remains explicit. Max 3 test adapters; no new production behavior. | All in-scope I behavior tasks accepted; any holds explicitly reflected in partial-verdict criteria → I-6-T4 |
| I-6-T4 | PREPARATORY / V | Return fresh I DoD, five-layer, secure rollback, snapshot and runbook verdict; list release-blocking HOLDs. No self-approval or inferred migration/deploy pass. | I-6-T3 evidence ready → END I; release roadmap refinement/retro |

## Debt and release handoff

These are planning references, not assertions that new shortcuts have already been introduced. Preserve historical resolved debt; link rather than silently reopen it. Owner for each until assignment: operator/maintainer. Review at H/I pull gates and retro; no security/data-integrity debt is accepted for release.

| ID / artifact / type | Cause; principal; recurring interest; compounding | Servicing decision / origin |
|---|---|---|
| BH-01 verification scripts/harness — reliability | Undiagnosed runtime resolution/entrypoint drift; principal M diagnosis+repair; each run loses trust; yes | H-1/H-2. Historical 855/0 is not current proof. |
| BH-02 daemon smoke/runbook — verification | Unresolved whole-process completion; principal M; parity regressions remain unseen; yes | H-3/H-4; preserve July finalizer/skills completion. |
| BH-03 deployment startup — operational/data | Historical unbuilt Docker and unsafe schema sync; principal roadmap J; upgrades cannot be trusted; yes | Release HOLD, no data-loss waiver; outside first two EPICs. |
| BI-01 status/intent model — domain safety | Board label and presence conflation; principal M plus decision/migration dependency; misleading controls each run; yes | I-1/I-2 safeguard, I-3 gated durable state. Cancel re-decomposed after contract. |
| BI-02 auth routes — security | Authentication mistaken for privilege, request-context gaps/abuse controls; principal M; exposure per request; yes | I-4/I-5 mandatory fail-closed repairs; never permissively waived. |
| BI-03 daemon tool policy — security | Policy omitted across execution boundary; principal M; unintended tool access per run; yes | I-6 mandatory compatibility/enforcement; no insecure fallback. |

After H: collect actual cycle times, rework, budget breaches, blocked time and assumption changes; refresh I sizing and release roadmap. After I: expand only the next ready EPIC(s). Roadmap J = schema/deployment, K = HTTP MCP, L = reaction/realtime reliability, M = setup/navigation/help/review UX, N = rollups/skills history/cost clarity/product polish. These are not decomposed or completed by this file.

## Validator handoff

**Independent validation:** see [the critic report](docs/gpm/state/backlog-validation-2026-09-07.md). No self-approved verdict. Fresh collection backlog critic checks DELIVERY structure, story DoR/HOLDs, task caps/Hats/pull edges, five layers, actual-versus-NEW contracts, security rollback, glossary, debt and operations. Return findings and readiness verdict to the program owner; corrections are authored in a new pass. A PASS for the plan means it can guide work; it does not mean the product, architecture choices, tests, migrations or deployment have passed.
