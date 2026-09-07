# SPIKE: H-1-T1 — Reproduce and classify verification failures

**Status:** COMPLETED on 2026-09-07; retained as the executed diagnostic brief.
See [accepted evidence](../evidence/H-1-T1-verification-diagnosis.md).

**Mode:** DELIVERY. **Hat:** PREPARATORY. **Tier:** R. **Size / timebox:** S — one bounded investigation, with no calendar estimate.

**Agent:** `gpm-partner-agent-v2.md`, execution of this diagnostic brief; use its required Core and GPM documents. GPM defines SPIKE as learning-oriented; PREPARATORY is this backlog item's classification. No restructuring is included.
**Unblocks:** H-1-T2, which implements the accepted repair recommendation.

## Objective and integration note

As the maintainer, I need reproducible verification evidence so I can distinguish a toolchain or installation problem from application defects before changing Conductor. This diagnosis feeds the release verification process. It must preserve the baseline and explain the first blocking failure; an unsupported green claim would make later changes impossible to assess reliably.

Produce only `docs/gpm/state/evidence/H-1-T1-verification-diagnosis.md`. Do not execute H-1-T2. Record uncertainty when the available evidence cannot establish a root cause.

## Context and pull gate

Read only the relevant excerpts of these files first (aim for at most 1,000 tokens beyond this prompt); expand into at most three complex modules if an import boundary requires it:

- `docs/gpm/state/current-state-review-2026-09-07.md`: R-01 evidence and R-13 stale-memory qualification.
- `package.json` scripts and `docs/adr/ADR-0007-node-runtime-bun-tooling.md` Decision: authoritative invocation and runtime contract.
- `.github/workflows/ci.yml` Test and Doctor steps: comparison with that contract.
- `src/__tests__/api/projects.test.ts` and `src/__tests__/helpers/auth.ts`: minimal known reproduction and database/auth isolation.
- Relevant TD-014b entry in `TECHNICAL_DEBT.md` only if order-dependent failures remain after package resolution is explained.

Before running diagnostics, record commit, working-tree status, runtime versions and executable paths. Compare actual scripts and ADR-0007 with this brief. If they differ materially, report `PULL GATE: FAILED`, explain the mismatch and update the diagnostic assumptions before continuing. A changed revision is evidence to reconcile, not permission to reset the workspace. Otherwise report `PULL GATE: PASS`.

**Contract facts:** package version 0.4.0; reviewed source `e85706e` (2026-07-13). `bun run test` invokes Bun with a 30-second timeout and excludes `e2e` and `.next`. Node runs database-touching application processes and the `tsx` doctor; Bun runs the mocked unit suite. CI currently invokes raw `bun test` and `bun scripts/doctor.ts`, bypassing those package-script choices. Command outputs are exit status, test totals and error details; failed imports can prevent test bodies from running. No application interface changes are planned.

**Observed on 2026-09-07:** Node 22.15.0; Bun 1.3.13. Type-check passed; lint: zero errors/four warnings; offline doctor: ten checks/zero failures/three warnings. Supported suite: 604 passes, 43 failures, 27 errors; 647 tests across 93 files. Isolated projects suite: zero passes/eight failures, with `Cannot find package mustache`. Node resolved installed `mustache` and `@opentelemetry/api`; Bun resolution returned `MODULE_NOT_FOUND` although package and entry files existed. There is no fresh coverage measurement.

**Hypotheses to distinguish:** executable/install/filesystem/module-resolution differences; application import or export defects; cross-file mock leakage associated historically with TD-014b. None is established solely by these counts. Historical green results and the old architecture memory are historical claims, not a replacement for current evidence.

Domain terms: **Conductor** is the application; **Project** is a container for Tasks and Agents; **verification baseline** is the recorded command, revision, environment and result. Do not rename product concepts or revise ADRs.

## Diagnostic procedure and constraints

1. Preserve the initial working-tree state. Inspect test setup and mocks before executing anything that could open a real database or make external calls. Do not read or print active `.env` contents. Use existing installed tools; identify executables using `Get-Command node,bun` and versions using `node --version` / `bun --version`.
2. Compare resolution from the repository root using these secret-free probes:

   ```powershell
   node -e 'for (const p of ["mustache", "@opentelemetry/api"]) { try { console.log(p, require.resolve(p)) } catch (e) { console.log(p, e.code, e.message) } }'
   bun -e 'for (const p of ["mustache", "@opentelemetry/api"]) { try { console.log(p, require.resolve(p)) } catch (e) { console.log(p, e.code, e.message) } }'
   ```

   Check only relevant installed package manifests, declared entry files, lockfile entries and filesystem link targets. Do not reinstall packages, change versions, regenerate Prisma, clear caches, alter lockfiles or widen access to make a result pass.
3. After confirming isolation, reproduce the known boundary with `bun run test ./src/__tests__/api/projects.test.ts`. Capture invocation, exit status, totals and first causal error. Run `bun run test` once if safe and necessary to compare the failure distribution. Stop repeated suite runs when they add no information. If isolation cannot be established, record the blocked command and use the available evidence; do not touch a real database to unblock this spike.
4. Compare new results with September evidence and any relevant historical green record. Classify import-resolution failures separately from failed application assertions. Examine test ordering/mock export surfaces only when evidence supports that branch. Explain the CI command mismatch separately; do not claim it caused local package resolution failures. A localhost connection refusal does not by itself establish a sandbox/network restriction. If a necessary diagnostic is actually blocked by sandboxing, use the normal scoped escalation process; no blanket widening.

No paid LLM calls, external services, network installs, real credentials, database writes, deployment or active `.env` changes are prerequisites. Temporary diagnostic files and sanitized logs belong under `tmp/gpm/H-1-T1/`; store only needed, reviewed, secret-free excerpts in the report. Do not dump environment variables or entire configuration files. Maximum output: 12,000 tokens; at most 1,200 changed LOC overall, with zero production/test/dependency/CI edits; target project context at or below 3,000 tokens. No production, test, dependency or CI implementation changes.

## Acceptance and handoff

**DoR: PASS for diagnosis.** Persona, goal, inputs/outputs, bounded constraints, acceptance and handoff are specified; no upstream implementation is required. INVEST: independently executable investigation; repair choice remains negotiable; restores verification confidence; sized S; one failure boundary; testable by evidence. Runtime contract and source dependencies are checked again at the pull gate. Architectural choices remain outside this task.

Given the recorded baseline, when the minimal probes and safe reproducer run, then the report contains exact invocations, environment/revision, exit results and September comparison; any unexecuted check has an explicit reason.

Given the resulting evidence, when failures are classified, then confirmed facts, plausible causes and unresolved questions are separate, and neither TD-014b nor application defects are inferred from package-resolution failures alone.

Given the diagnosis, when H-1-T2 is prepared, then the report names the smallest recommended repair, affected files, meaningful regression check, risks and any remaining decision needed. If inconclusive, specify the next discriminating experiment; H-1-T2 remains gated until its repair is sufficiently defined.

**Definition of Done (three outcomes):** reproducible evidence report; evidence-supported classification; actionable H-1-T2 handoff with readiness stated. Existing tests are diagnostic evidence, not required to become green in this SPIKE. TDD, new-logic coverage, feature flags and new integration contract tests are inapplicable because no implementation is produced; record these as N/A rather than claiming they passed. Report start/end, rework and any newly discovered debt candidate without editing the debt register.

**Rollback:** no production changes. Retain the evidence report and remove only task-created scratch files if cleanup is needed; verify their resolved paths remain beneath `tmp/gpm/H-1-T1/`. Compare final working-tree status with the baseline and report unexpected changes without reverting user work. No architecture decision is made or approved by completion of this prompt.
