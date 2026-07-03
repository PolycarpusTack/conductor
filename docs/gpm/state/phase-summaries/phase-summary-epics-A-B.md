# Phase Summary — EPICs A + B (+ EPIC C quick wins)

Date: 2026-07-03. Commits `60738ca..e8e51d4` (14 story commits, one session, parallel agent execution).

## What was built

**EPIC A — Real Daemon Execution (tracer bullet) — COMPLETE**
- A-0 spike: verified headless `claude -p` invocation contract (stdin prompt, NDJSON stream, is_error semantics) — `spike-a0-headless-cli.md`
- A-1: Execution Payload (payloadVersion 1) delivered to the spawned CLI — stdin instructions, temp-file system prompt, shell-less spawn; loud template-token validation
- A-2: workspace cwd enforcement (DAEMON_WORKSPACE_ROOT, traversal guard, deny-by-default step policy, no process.cwd() fallback)
- A-3: OutputBatcher live session events, git diff/status evidence artifacts on complete AND fail, artifact persistence on POST /api/daemon/steps
- A-4: `bun run smoke:daemon` — 13-check spend-free e2e gate incl. daemon-kill lease reclaim; **found and fixed a release blocker: daemon registration had never worked (zod v4 z.record enum semantics → z.partialRecord)**

**EPIC B — Engine Correctness & Safety — COMPLETE**
- B-1 lease-first dispatchStep (+ in-flight guard, atomic attempt allocation) — double-LLM-dispatch race closed
- B-2 claim leases + reaper: Model-B tasks can no longer be stranded by dead agents (15-min renewable lease, 60s sweep)
- B-3 stale daemons release step leases in ~30s (was 10 min)
- B-4 project-scoped API keys (ApiKey.projectId, Cascade-on-delete, legacy keys warn)
- B-5 SSRF guard on HTTP reactions, WS secrets required in prod, workspace-strict daemon dispatch
- B-6 dispatchStep test suite: dispatch-path AC range 100% covered; dispatch.ts 94.7% overall
- B-7 spend budgets (Project.budgetUsd, month-to-date StepExecution.cost, pause/resume with deduped activity, settings field + header chip) + TD-018 cost wiring

**EPIC C (expanded early, localized only):** C-1 silent failures → toasts/error states, C-2 optimistic DnD with rollback, C-3 markdown rendering, C-6 loading skeletons, C-7 landing copy. **D-7** README truth pass.

## What was learned (assumptions validated/invalidated)

- A3 (claude headless first) — validated; contract verified live for ~$0.08.
- "Docs promise vs reality" was worse than reviewed: registration itself was dead code — the smoke, not the review, caught it. E2E gates > static review for integration seams.
- Anthropic adapter reports tokens, not cost → budgets rest on estimateCost fallback (TD-020); daemon runs create no StepExecution rows → budgets bind only for HTTP agents (TD-018 remainder).
- bun's shared mock.module registry caused one 73-test breakage mid-phase; convention (mock only @/lib/db + realtime) now proven across 7 new suites.

## What changed from the plan

- Pull-gate deviation (user-sanctioned): B stories ran parallel to EPIC A on disjoint files — no rework resulted.
- C quick wins + D-7 pulled forward (idle-lane utilization); D deliberately still held for EPIC E.
- B-4: model is ApiKey not ScopedApiKey; enforcement via assertKeyProjectAccess helper (target project unknown at auth time).
- A-2: echo runner also requires a mapped workspace (AC read strictly).

## Debt register (active)

TD-015 (dispatch-failed activity spam), TD-016 (template validation timing), TD-017 (argv quoting), TD-018-remainder (daemon StepExecution rows — budgets/costs for DAEMON agents), TD-019 (5000-char output cap), TD-020 (estimated vs true cost), TD-021 (budget_lifted timing), NEW: daemon terminal failures never dead-letter (runbook-documented; fold into TD register at F-5), test-suite mock load-order fragility.

## Flow notes (retro)

- 14 stories via ~12 parallel background agents; zero merge conflicts (file-ownership partitioning + exclusive schema lane worked).
- Rework rate: 0 stories reworked; 2 parent-side fixes post-agent (zod fix was product debt, doctor.ts stream typing).
- Suite: 531 → 702 tests, all green; type-check clean throughout.
- Next-phase actions: (1) wire daemon runs into StepExecution rows early in the next daemon iteration; (2) keep the smoke in CI candidates (F-1/F-6); (3) ADR-1..3 still unwritten — do them at EPIC F or when touched next.
