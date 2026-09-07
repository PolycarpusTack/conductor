# Independent validation: September GPM and backlog

Date: 2026-09-07. Reviewer: separate Codex agent applying
`C:/Projects/ClaudeExtras/01-agents/library/backlog-product/backlog-critic-agent.md`,
its Policy Kernel, and this repository's Core Specification v1 / Backlog Builder
v5.1. This is an independent planning review, not the backlog author's self-check.
No application changes, test runs, architecture approvals, or deployments were
performed by this reviewer.

## Verdict and scope

**Final recheck: PASS for planning quality and the bounded H-1-T1 diagnostic
prompt. No unresolved critical planning findings remain.** All seven findings
below were addressed and independently re-read. The initial consistency FAIL is
retained as review history; it is superseded by the correction recheck below.

The package is complete enough to guide refinement and select eligible work.
**H-1-T1 is READY for diagnosis after its isolation/source pull gate; implementation
and release remain HOLD behind their recorded prerequisites.** This verdict does
not authorize execution, accept an architecture choice, or assert product health.

Reviewed files: root `backlog.md`; `working-program-2026-09-07.md`;
`current-state-review-2026-09-07.md`; `prompts/H-1-T1-reproduce-verification.md`;
`architecture-memory.md`. Relevant source was inspected for MCP empty-selection
semantics and reaction-output dependencies; referenced fixture/ADR paths were
checked. Line references below identify the initial reviewed revision and may
move when the coordinator applies corrections.

## Initial critical findings (resolved at recheck)

| ID | Evidence and consequence | Minimal action |
|---|---|---|
| V-01 | `backlog.md:106` requires `spike-H-1-reproducibility.md` and a proposed entrypoint snapshot, while `prompts/H-1-T1-reproduce-verification.md:12` permits only `evidence/H-1-T1-verification-diagnosis.md`. The first pull therefore has two incompatible output contracts. | Make the prompt's evidence path canonical in the backlog; put the actual entrypoint snapshot in H-1-T2 after repair acceptance. |
| V-02 | `backlog.md:59` caps R/X tasks at 12,000 output tokens and 1,200 changed LOC; prompt `:48` allows 15,000 tokens and gives no matching overall changed-LOC cap. The first task's prepared prompt does not inherit its stricter backlog budget. | Align the prompt to 12,000 output tokens, 1,200 changed LOC maximum, three inspected complex modules, and zero production/test/dependency/CI implementation edits. Preserve the <=3,000 context target. |
| V-03 | `backlog.md:304,329,355` chain legacy credential migration to request protections and then MCP enforcement through checkpoints. Program `:151,158` says non-schema security repairs need not wait for the migration lane. A literal task pull would unnecessarily hold independent fixes behind I-3/J or I-4 legacy decisions. | Separate mandatory dependencies from preferred queue ordering. Permit I-4-T1, I-5-T1, and I-6-T1 after H and their own accepted I-1 slices; preserve true intra-slice dependencies and WIP=1. Keep schema/legacy transitions explicitly held until their own decisions/lane pass. |
| V-04 | Program Mermaid `:165–180` has no outgoing acceptance edge from schema-dependent I, and permits Local review without explicit K/J/I completion joins, although `:54–59` requires those accepted scopes. A reader following the diagram can infer a release path that skips required gates. | Add an explicit AND acceptance join for the local profile requiring H, accepted I scope including any selected schema-dependent controls, safe local schema handling, K/L, M and honest N claims; production additionally requires built deployment/provider evidence. Keep J independent of the I schema work it enables. |

## Initial refinement improvements (resolved at recheck)

| ID | Evidence | Recommended action |
|---|---|---|
| V-05 | `backlog.md:73` still labels the refreshed architecture memory historical; prompt `:18,30` can be read as describing the old contradiction as current. | Call the memory current, retain R-13 as historical/resolved planning evidence, and recheck at each pull. |
| V-06 | Current review `:20` explicitly preserves empty-deny, while program D-26-06 `:200` leaves "empty allowlist" ambiguous. Source `mcp-resolver.ts:130–135` denies all for connection `scopes=[]`; `:28–35` uses null for legacy unrestricted configuration, and mode `toolAllowlist=[]` currently does not narrow at `:88`. | Preserve explicit empty connection selection as deny-all, distinguish absent/legacy and mode-field meanings, and add the empty-selection denial case to I-6. Changes to legacy/mode semantics remain an approved-contract gate, not an assumed fact. Verify actual CLI invocation denial before declaring enforcement compatible. |
| V-07 | L-1 program `:154` promises durable independent delivery but does not explicitly repeat transaction/ordered-output requirements. Review `:24` requires both; `reactions/executor.ts:57–86` shows earlier outputs rendered into later reaction configuration. | Make transactional enqueue and dependent-reaction ordering/output/blocked-state preservation explicit L-1 refinement acceptance. Independent reactions may continue; dependent ones must not consume missing or stale predecessor output. Keep the schema/ADR HOLD. |

## What the package gets right

- **Structure:** two fully decomposed epics, ten unique stories, and 25 unique tasks.
  H is the brownfield tracer epic. H-1 and I-1 are roots within their epics; I's
  external H predecessor is explicit. All task rows name one Hat, one capability
  tier, a pull gate, and an Unblocks/end marker. J–N remain roadmap candidates.
- **Dependency safety:** no cycle was found in the initial task graph. J's safe
  migration lane does not depend on completing the I schema work it enables.
  V-03 is an unnecessary gating/interpretation defect, not a cycle. Different
  eligible roots remain sequential under WIP=1.
- **Readiness:** all ten story sections include persona/value, Gherkin happy and
  error/edge behavior, interfaces or planned-contract gates, dependencies,
  security considerations, fixtures, idempotency and INVEST. Missing contracts
  are marked HOLD. I-1 is ready for decision preparation after H; H-1's diagnosis
  slice is the only immediate candidate. No whole implementation story is
  unconditionally ready now, and missing owner decisions are not concealed.
- **Execution bounds:** every task inherits conservative output/LOC/three-module
  ceilings and stops for decomposition if it exceeds them. V returns verdicts
  without authoring code/runbooks. Shared contract excerpts, refreshed memory
  and task-specific snapshots make the <=3,000-token project-context target
  feasible; loading the entire backlog/program into every prompt would not.
- **Testing and operations:** both detailed epics have three-item DoDs, explicit
  E2E smoke work, proposed numeric objectives and runbook outputs. Unit coverage
  of new logic, consumer/provider contracts, real isolated persistence/API,
  browser/child-process smoke, and performance are allocated by risk. N/A layers
  are justified instead of counted as passes. Documentation does not require
  artificial implementation-mirroring tests. Logs, W3C tracing and golden signals
  reuse the existing stack.
- **Security and state:** UI flags never disable mandatory access/control guards.
  Rollback disables an unsafe capability or uses a demonstrated safe version;
  it cannot reintroduce wildcard tools or excessive credential access. Pause is
  new-work eligibility, not process termination. In-flight completion, leases,
  external pull clients and cancel fencing require explicit contracts. New schema
  needs safe migration and restore evidence, with no accepted data-loss waiver.
- **Governance:** existing ADRs and implemented July work are preserved; new
  lifecycle/access/tool/verification decisions are visibly proposed. High and
  Medium risks have named mitigations, owner and a dated program review. Data
  classification, anonymized fixtures, evidence scrubbing, retention proposals
  and DPIA-lite refinement are explicit. Debt IDs link current gaps to origins;
  optional enhancements and accurate release claims remain traceable.
- **Evidence honesty:** the 604-pass/43-failure/27-error result is supplied review
  evidence, not this critic's test run or 43 confirmed product defects. Bun's
  installed-package resolution failure is separated from Node success and from
  historical mock leakage. Coverage, production SLOs and live deployment health
  are UNKNOWN. Local development proof and production deployment proof are
  separately gated; local-first is an assumption, not owner acceptance.

## Validation scorecard

| Criterion | Final planning result |
|---|---|
| Unique structure and maximum initial depth | PASS: 2 epics / 10 stories / 25 tasks |
| Story DoR or explicit HOLD | PASS: 10/10 governed; diagnosis-only first pull |
| DAG and root stories | PASS: acyclic task edges and explicit independent branches/acceptance joins; V-03/V-04 resolved |
| Task Hat/tier/pull/Unblocks/caps | PASS: 25/25 rows comply; H-1-T1 output and budget agree with its prompt |
| Five risk-appropriate test layers | PASS for planned allocation; no execution result inferred |
| Observability/runbook/smoke | PASS: 2/2 detailed epics; roadmap detail deferred explicitly |
| ADR governance | PASS for planning: existing ADRs referenced; unresolved decisions gate implementation |
| Risk/data/debt governance | PASS for planning; mitigations are future work, not accepted residual exposure |
| Full implementation readiness | HOLD; no blanket code-generation approval |
| Product/release readiness | NOT ASSESSED by this document; known release gates remain open |

## Correction recheck — 2026-09-07

The reviewer re-read the changed backlog, program, and prepared prompt from disk,
then performed a read-only structural extraction of task IDs, Hats/tiers,
Unblocks targets and topological order. This was document verification, not an
application test run. Result: two epic declarations, ten story declarations,
25 unique task IDs, no malformed Hat/tier or missing arrow rows, no unknown
task targets, and an acyclic task graph. J and release-profile relationships
were reviewed separately in the program; no J/I dependency cycle was found.

| Finding | Rechecked correction | Status |
|---|---|---|
| V-01 | `backlog.md:119` and prompt `:12` now produce only `evidence/H-1-T1-verification-diagnosis.md`; H-1-T2 owns the actual entrypoint snapshot. | RESOLVED |
| V-02 | Prompt `:16,48` now matches the three-module, 12,000-output-token, 1,200-changed-LOC ceilings and zero implementation changes. | RESOLVED |
| V-03 | `backlog.md:71–82,239,316,342,368` names mandatory branch gates. Role, request, and tool-policy work can pull independently after H and their own approved I-1 slice. The `:80,370–371` acceptance join cannot accept an epic while required branch evidence is held. | RESOLVED |
| V-04 | Program `:163–200` explicitly joins all required local evidence with AND; production additionally joins Local with J2/advertised J3 evidence. Schema-dependent I is required when selected and otherwise needs an explicit scope decision. J does not depend on its downstream I work. | RESOLVED |
| V-05 | `backlog.md:86` names current architecture memory; memory is dated September 7 and the baseline R-13 records the historical contradiction and planning resolution. Prompt references to old evidence remain explicitly historical. | RESOLVED |
| V-06 | `backlog.md:364` adds empty-connection denial, null legacy, empty-mode and compatibility fixtures. Program D-26-06 `:215` distinguishes their current meanings and holds any changed semantics for decision. Actual invocation-denial evidence and unsupported-runner refusal remain required. | RESOLVED |
| V-07 | Program L-1 `:154` requires transactional event-to-delivery enqueue and preservation of dependent output/order, including explicit blocked/skipped results after predecessor failure. Its migration/contract gate remains intact. | RESOLVED |

No further material inconsistency was found in this bounded recheck. Proposed
shared numeric targets do not override the explicit H/I epic targets; program
verification notes state that precedence and require calibration before
performance acceptance. Source facts remain separate from proposed interfaces.

## Remaining implementation and owner gates

- H-1-T2 requires a causal diagnosis, bounded repair and supported runtime matrix.
  H's daemon smoke, full verification and artifact claims still need actual
  evidence. The supplied September failures have not been repaired by planning.
- Yannick still owns local/production release scope, lifecycle/pause/cancel and
  late-completion decisions, safe migration strategy, credential compatibility,
  request/reset policy, tool-policy/CLI compatibility, Waiting/Review semantics
  and optional feature scope. Draft recommendations are not accepted decisions.
- New schema remains behind J's approved migration/restore lane. A no-schema
  lifecycle option selected by I-1 must cause the additive-state I-3 tasks to be
  refined before execution; the current HOLD prevents an accidental field choice.
- Non-schema security branches may progress after their own gates pass, with
  WIP=1. Neither partial smoke evidence nor disabling a UI flag permits unsafe
  execution/access or a complete I/release verdict.
- J–N require the next bounded refinement passes. Production needs actual build,
  browser, persistence, restore and advertised-provider proof; local development
  evidence does not establish a Windows production package or shared deployment.

**Decision:** APPROVED as a planning package and diagnostic first-task brief.
**Not approved:** blanket code generation, owner decisions, any HOLD waiver, or
release/deployment certification. The unresolved gates above are explicit work
and decision dependencies, not unfinished planning-document corrections.
