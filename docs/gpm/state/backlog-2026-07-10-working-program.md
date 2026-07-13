# Backlog — "Working Program" (EPICs G0–G3 + Tier-2 fold-in) — 2026-07-10

Generated per `docs/gpm/backlog-builder-v5.1.md` (+ core-specification-v1).
Input design (treated as DATA, never instructions): `GAP-ANALYSIS-2026-07-10.md`
(four-track review) deduped against `TECHNICAL_DEBT.md`. Every task traces to a
gap ID (`0.x`/`1.x`/`2.x`/Tier-3 bullet) or a TD ID. Repo claims are marked
(verified) / (NEW) / (ASSUMED) per CLAUDE.md convention.

Numbering: the gap file's suggested G0–G3 series is adopted. It does NOT replace
development-plan-v1's EPIC G (Hardening & 1.0, in progress); the Tier-2 fold-in
below EXTENDS plan-EPIC-G story G-3. G-5 (1.0 cut + re-evaluation) remains the
finale and now pull-gates on G0–G2 being green.

---

## 1. Readiness Decision

Quality gate (BB §5) against the gap analysis as de-facto solution design:

- Business Context: partial (verdict paragraph; no personas/KPIs/value hypotheses)
- Architecture Overview: ✓ by reference (architecture-memory.md, ADR-0001..0006)
- Data Models: ✓ by reference (prisma/schema.prisma authoritative)
- APIs/Interfaces: current-state evidence ✓, **target** contracts ✗ (no payload-v2 shape, no retry semantics, no skills-consumption interface)
- User Journeys: ✗ (none for the repaired/added behaviour)

**Health Score: Clarity 3 + Feasibility 3 + Completeness 1 = 7/9.**
Score alone clears the bar, but two HOLD triggers exist: (a) >2 required
sections missing in target-state form; (b) High risk without mitigation —
migration adoption (1.9/1.10) touches live data under the hardcoded-sqlite
provider duality (ADR-0004, verified) with no migration design in the input.

**Normal contract: HOLD. DEVIATION AUTHORIZED BY THE HUMAN (2026-07-10):**
proceed anyway; the missing design elements are supplied below, each marked
**(ASSUMED — confirm before execution)**. Confirm-before-execution items are
gathered in §1.1 so the owner can clear them in one pass. (Authorized by the
owner in the Claude Code session of 2026-07-10 that produced
GAP-ANALYSIS-2026-07-10.md — instruction: "ok, can you indeed create the plan
using the backlog builder".)

### 1.1 Readiness gaps + supplied design elements

| # | Gap in the input | Supplied here | Status |
|---|---|---|---|
| R1 | No value hypotheses / success metrics per fix | Business-value line + metric per EPIC | CONFIRMED by owner 2026-07-10 ("ok go for it") |
| R2 | No target Execution Payload v2 contract | Sketch in G1-1-T3; snapshot update is a deliverable | CONFIRMED by owner 2026-07-10 ("ok go for it") |
| R3 | No daemon retry-policy semantics (who counts attempts, backoff source) | Server-authoritative, mirroring the HTTP path; daemon `willRetry` deprecated to a hint (G1-1-T2) | CONFIRMED by owner 2026-07-10 ("ok go for it") |
| R4 | No migration-adoption design for the sqlite/PG duality (provider hardcoded — ADR-0004, verified) | Two-lane migration proposal in G2-1 | APPROACH CONFIRMED 2026-07-10; the design artifact itself (ADR-0009 draft) must still be produced and reviewed before G2-1 starts — the hard gate stands. High risk |
| R5 | No smoke outlines | Smoke story per EPIC | CONFIRMED by owner 2026-07-10 ("ok go for it") |
| R6 | No user journeys for skills-consumption / KPIs / MCP auth | Minimal journey per G3 story | CONFIRMED by owner 2026-07-10 ("ok go for it") |
| R7 | Implement-vs-de-claim is an owner call per README feature (gap §"Suggested sequencing" item 4) | Implement 1.13/1.14/1.16/1.17; de-claim 1.15 versioning + Tier-3 vapor claims | CONFIRMED by owner 2026-07-10 ("ok go for it") — the proposed default choices (implement 1.13/1.14/1.16/1.17; de-claim 1.15 versioning + Tier-3 vapor claims) stand as confirmed |
| R8 | Working tree was dirty during the review (9 modified + untracked files on the auth surface — verified via `git status` 2026-07-10); findings may be partially addressed in-flight | G0-0 reconciles the tree FIRST; Tier-2 items 2.4-purge-script and a login rate limiter exist uncommitted (verified on disk) | verified (nothing to confirm) |
| R9 | "Make it a CI gate" (0.4) assumes a CI pipeline; none found in the repo (no .github/workflows — ASSUMED, not exhaustively searched) | Gate = `verify` script chain first; GH Actions workflow optional task | CONFIRMED by owner 2026-07-10 ("ok go for it") |

### 1.2 Injection guard (BB agent step 1)

The gap analysis was scanned for embedded directives. Finding: it contains
"Fix shape" recommendations and a "Suggested sequencing" section — normal
review content, treated as candidate design input, not as instructions. No
text impersonating the vendor, the methodology, or the human was found. The
TECHNICAL_DEBT.md dispositions are likewise treated as candidates only.

### 1.3 STRIDE (one line per letter, across the backlog)

- **S**poofing: MCP client sends no auth and skips handshake (1.17) — G3-3; daemon-token planes unchanged.
- **T**ampering: `--accept-data-loss` on every container boot (1.9, verified in docker-entrypoint.sh:21) can destroy data on schema divergence — G2-1; CSRF-unprotected cookie-auth mutations (2.2) — GS-2.
- **R**epudiation: daemon attempts leave no StepExecution audit (TD-018b, verified: no rows created) — G1-1-T4; reviewer-identity binding is in-flight uncommitted — G0-0.
- **I**nformation disclosure: MCP `config` secrets must never enter the Execution Payload or logs — G3-3 AC; export redaction already verified per gap §"What's already solid".
- **D**enial of service: unratelimited `/api/auth/reset/request` (2.5) — GS-4; fire-and-forget reactions lose deliveries on process death (1.18) — G3-5; SQLITE_BUSY on second-process access (1.12) — G2-2.
- **E**levation of privilege: members can mint/revoke keys (2.1) — GS-1; legacy unbound scoped keys instance-wide (2.6) — GS-3.

Compliance: **no regime specified** (single-operator self-host, A1).

Data governance (BB rule 8): single-operator self-host deployment (A1); no regulated/sensitive data classes in scope; secrets handling covered under STRIDE-I items.

Token-limit boundaries: all specified tasks est. ≤ 15k output. Watch G3-3
(MCP handshake + transport + auth) — pre-split into transport vs auth tasks.

---

## 2. Domain Glossary additions (P3 — enforced)

Canonical terms live in `architecture-memory.md` §Glossary. This backlog adds:

- **Finalizer** (NEW, G1): the single shared bookkeeping routine that closes a
  step attempt — StepExecution finalize, retry/backoff decision, dead-letter,
  notification. One implementation; HTTP and DAEMON paths are its two callers.
- **Migration Baseline** (NEW, G2): the first `prisma migrate` snapshot that
  declares the current schema as migration zero, per provider lane.
- **Outbox** (NEW, G3): durable persisted queue row for a reaction delivery,
  retried by the scheduler; replaces inline fire-and-forget.
- **Rollup** (NEW, G3): a cross-project aggregate KPI (cycle time, review wait,
  rejection rate, cost per task).
One term per concept: "parity" is prose, never a code identifier; the daemon
completion path calls the **Finalizer**, not a "handler"/"reporter" synonym.

## 3. Assumptions (extends assumptions-ledger.md; add there on acceptance)

- **A10 ⚑** Runtime story resolves **Node-first**: server, doctor, build run
  under Node; Bun stays for `bun test`/tooling where it works. Basis:
  phase-summary-epic-F + HANDOFF "app server runs under Node, not Bun"
  (verified in state docs; server.log evidence per gap 0.3 not re-verified).
  If wrong (owner wants Bun+Postgres-only): G0-2/G0-3/G0-4 change shape. ASSUMED.
- **A11** Old daemons need no compatibility window for payload v2 / server-side
  retries — single-operator (A1) + no external users (A8) permit the breaking
  protocol bump. If wrong: G1-1 needs payloadVersion negotiation. ASSUMED.
- **A12** A Linux/Docker host will be available for G2 (external dependency —
  the dev host is Windows without Docker, verified A9 + TD-024).
  **FAILED 2026-07-13 — owner confirmed no Linux/Docker host is available,
  indefinitely.** G2 parked except G2-2 (WAL pragmas — pulled into G3-7-T0);
  G3-5 HOLD carries the schema-lane consequence (see its line).
- **A13** MCP tools for daemon agents target the **claude runner only** via
  generated `--mcp-config`; the generic runner documents MCP as unsupported.
  **CONFIRMED 2026-07-13** — spike G1-3-T0 verified all mechanics on the dev
  host (`state/spike-g1-3-mcp-config.md`): GO for T1.

---

## 4. Backlog

**Initial full decomposition: EPICs G0 and G1 (BB rule 4). G2, G3, and the
Tier-2 fold-in are scoped at story level; expand after the G1 retro (BB §10) —
G2 additionally waits on A12.** Sequencing per the gap file: gates → daemon
parity → proven deploy → truth-in-features; Tier-2 folds into plan-EPIC-G G-3;
Tier 3 rides along opportunistically (G3-6).

Priorities are H/M/L with one-line justification (human requirement; BB 1–5
scores omitted at owner's format request). Model tier per Core §6.

---

### EPIC G0 — Green Gates

- **Objective:** every quality gate (`type-check`, `doctor`, dev boot, `next build`) passes honestly on the default install, and the runtime story is decided and documented.
- **Tracer Bullet?:** NO (brownfield repair)
- **Mode: DELIVERY** — repo-wide mode is DELIVERY (verified mode.md 2026-07-03); the gates ARE the fitness functions (P7), so they land at full governance despite small size.
- **DoD additions:** (1) `bun run type-check && bun run lint && bun test && doctor && next build` all green in one session on the dev host; (2) README/INSTALL runtime claims match reality; (3) working tree clean — no orphaned story edits.
- **Business Value (ASSUMED — confirm):** without green gates every later EPIC's DoD is unverifiable; unblocks G-5's 1.0 cut. Metric: 4/4 Tier-0 gaps closed, verified by the smoke chain.
- **Risk:** LOW-MED — G0-0 may reveal incomplete in-flight stories (rework). Mitigation: per-story verify-or-discard decision, never a blob commit (HANDOFF protocol, verified).
- **SLO:** Gates — full verify chain green in < 10 min on the dev host.
- **ADRs:** ADR-0007 "Runtime story: Node-first server, Bun tooling" (NEW, G0-3).
- **Smoke Test Story:** G0-4 (the build IS the epic smoke).
- **Runbook:** append "gate failure triage" to the EPIC F ops runbook.

**G0-0 — Reconcile the dirty working tree.** (traces: gap-file header note + HANDOFF.md; Priority **H** — every finding and every gate reading is suspect until the tree is clean)
As the **owner**, I want the uncommitted G-1/G-3/G-4 story edits verified and committed (or discarded) per story, so that gates measure reality and the gap analysis can be re-baselined.
AC: Given the 9 modified + untracked files (verified 2026-07-10), When grouped by story per HANDOFF (G-1 Playwright / G-3 security / G-4 perf), Then each group is either verified-and-committed or explicitly discarded with a note; And `git status` is clean; And TECHNICAL_DEBT.md reflects anything G-3 resolved (candidates: 2.4 purge script, login rate limiter — both exist on disk, verified).
Test expectations: the three new test files (`review-identity-binding`, `legacy-key-purge`, `login-rate-limit`) pass; unit suite stays ≥ 842 green (quiet host per HANDOFF flakiness note).
- **G0-0-T1** (Hat PREPARATORY, Model Sonnet): execute the HANDOFF reconciliation checklist; one commit per story. Pull Gate: none (first task). Unblocks G0-1. END OF STORY.

**G0-1 — Type-check gate green.** (traces: 0.1; Priority **H** — a red gate with 0 real errors trains everyone to ignore the gate)
Task-type work item (no persona — infrastructure gate repair).
AC: Given `.next/dev/types/**` excluded from tsconfig include (line 40, verified) or cleared in the script preamble, When `bun run type-check` runs on a box with a dirty `.next/dev`, Then it exits 0 with real source errors still detectable (negative test: introduce a deliberate type error, gate goes red).
Test expectations: the negative test above, scripted or documented in the commit.
- **G0-1-T1** (REFACTORING, Haiku): tsconfig include fix + negative-test verification. Pull Gate: G0-0 tree clean. Unblocks G0-2. END OF STORY.

**G0-2 — Doctor runs on the default install.** (traces: 0.2; Priority **H** — the self-diagnostic that can never pass is anti-documentation)
Task-type work item (no persona — infrastructure gate repair).
AC: Given a default SQLite install, When `bun run doctor` is invoked, Then it detects Bun-incompatibility and re-execs under Node (or the script is Node-entry outright per A10), and completes its checks; Given Node absent, Then it fails with a clear message naming the requirement (never the raw better-sqlite3 load error).
Test expectations: doctor exit 0 on the dev host; unit test for the re-exec/entry decision if implemented as a shim.
- **G0-2-T1** (FEATURE, Sonnet): Node re-exec shim or entry swap per A10; update package.json script. Pull Gate: A10 confirmed by owner OR proceed marked ASSUMED. Unblocks G0-3. END OF STORY.

**G0-3 — Runtime story decided and documented.** (traces: 0.3; Priority **H** — the self-contradiction ("Bun project" that needs Node) blocks any honest install doc)
As a **new operator**, I want `bun run dev` (or the documented equivalent) to boot the app on the default path, so the first-run experience matches the README.
AC: Given ADR-0007 (Node-first per A10) accepted, Then README/INSTALL/package.json scripts agree with it (no "Bun 1.3+" server claim); Given the default SQLite path, When the documented dev command runs, Then the server boots without the instrumentation Prisma failure (gap cites server.log ~5x — ASSUMED, not re-verified).
Test expectations: manual boot verification recorded in the commit message; docs diff reviewed against ADR-0007.
- **G0-3-T1** (PREPARATORY, Opus — judgment: the decision + ADR): write ADR-0007 with alternatives (Node-first vs Bun+Postgres) and consequences. Pull Gate: A10 owner confirmation. Unblocks G0-3-T2.
- **G0-3-T2** (FEATURE, Sonnet): align scripts + README + INSTALL with ADR-0007; make the default dev command boot. Pull Gate: G0-3-T1 landed + suite green. Unblocks G0-4. END OF STORY.

**G0-4 — First verified production build + standing gate.** (traces: 0.4; Priority **H** — "no production build has ever succeeded" is the single loudest not-a-working-program fact)
AC: Given `.next/dev` cleared and Node runtime, When `next build` runs, Then BUILD_ID and `.next/static` exist (first verified artifact); And a `verify` script chains type-check + lint + test + doctor + build so the gate is one command; Given R9 (no CI — ASSUMED), Then a GH Actions workflow running the chain is added only if the owner confirms CI is wanted, else the script is the gate.
Test expectations: build succeeds on the dev host (Windows dev-build; the Linux standalone proof belongs to G2); `verify` chain green end-to-end = **EPIC G0 smoke**.
- **G0-4-T1** (FEATURE, Sonnet): build preamble (.next/dev clear) + `verify` script + first successful build. Pull Gate: G0-1..G0-3 green. Unblocks: G0-4-T2 (optional) + G1-1.
- **G0-4-T2** (FEATURE, Haiku, OPTIONAL per R9): GH Actions workflow for the chain. Pull Gate: owner confirms CI wanted (R9). END OF STORY / END OF EPIC → retro; re-baseline gap list against the reconciled tree.

---

### EPIC G1 — Daemon Parity

- **Objective:** a DAEMON-mode step gets the same engine guarantees as an HTTP step — resolved prompt, chain context, server-owned retries, dead-letter + notification, StepExecution/cost/budget binding.
- **Tracer Bullet?:** NO — but G1-1 is a deliberate END-TO-END FIRST slice (one daemon step at full engine standard through all layers), not layer-by-layer.
- **Mode: DELIVERY** — the daemon lane exited PROTOTYPE 2026-07-03 after the EPIC A e2e gate (verified mode.md); this is feature completion on a validated architecture, TDD mandatory.
- **DoD additions:** (1) no literal `{{token}}` ever reaches a spawned CLI; (2) every daemon terminal failure is visible in the dead-letter panel AND the notification bell; (3) budgets demonstrably pause a project whose spend comes from daemon runs only.
- **Business Value (ASSUMED — confirm):** the gap file calls this "the highest-value block in the whole list" — the headline execution path becomes production-grade. Metric: gap 1.1–1.7 all closed; TD-018b + TD-025 resolved in the register.
- **Risk:** MED — Finalizer extraction touches dispatch.ts, the hottest path (94.7% covered, verified architecture-memory). Mitigation: extraction is PREPARATORY with the existing suite as the invariant (G1-1-T1 changes zero behaviour). MED — protocol bump breaks old daemons. Mitigation: A11 accepted; smoke:daemon is the compatibility proof.
- **SLO:** Daemon engine — terminal-failure visibility = 100% (every exhausted step has a dead-letter row + notification); StepExecution rows exist for 100% of daemon attempts.
- **ADRs:** ADR-0008 "Server-authoritative daemon retry & Finalizer" (NEW); amend ADR-0003 (budget point now binds for DAEMON via StepExecution).
- **Smoke Test Story:** G1-1-T5 (extends `bun run smoke:daemon`, 13-check e2e, verified).
- **Runbook:** extend `phase-summaries/epic-A-runbook.md` (its "daemon failures never dead-letter today" caveat, verified, gets deleted — that's the point).

**G1-1 — One daemon step end-to-end at engine standard (thin slice).** (traces: 1.1, 1.2, 1.4, 1.5, TD-018b, TD-025; Priority **H** — every daemon failure is currently single-attempt, invisible, and unbilled)
As the **operator**, I want one DAEMON step to run with a resolved prompt and chain context, retry on failure under server policy, and land in the dead-letter panel with a notification and a StepExecution row when exhausted, so the daemon path is trustworthy end to end.
AC (Gherkin core):
- Given a step whose instructions contain `{{task.title}}`/`{{memory.recent}}`, When the payload is served, Then the CLI receives resolved text (verified today: `resolvePrompt` is only called in dispatch.ts — the daemon route never calls it).
- Given a mid-chain step, Then the payload carries the previous step's output (parity with dispatch.ts:218-243 per gap — line refs ASSUMED).
- Given the daemon reports `fail`, Then the SERVER decides retry vs terminal from step maxRetries/backoff (daemon `willRetry` demoted to a hint — verified today: server trusts it and the reference daemon hardcodes `willRetry:false`, index.ts:218).
- Given retries exhausted, Then `moveToDeadLetter` + `notifyDeadLetter` run (verified today: neither appears in api/daemon/steps/route.ts) and the board dead-letter chip + bell show it.
- Given any attempt, Then a StepExecution row exists with startedAt/completedAt and cost/turns lifted from the claude metadata artifact, and month-to-date budget math includes it (TD-018b).
Test expectations: fake-CLI runner suite extended (retry sequence, exhaustion, token-resolution assertion); route tests for Finalizer wiring; budget-binding test (daemon-only spend ≥ budget → project skipped next tick).
Idempotency: existing step lease + attempt allocation (ADR-0002) — StepExecution keyed by (stepId, attempt).
INVEST ✓ (E: builds on snapshot v1, verified). DoR: READY (after G0).
- **G1-1-T1** (Hat PREPARATORY, Sonnet): extract the **Finalizer** from dispatch.ts (complete/fail/backoff/dead-letter/notify/StepExecution-finalize) into a shared module; HTTP path re-wired onto it; behaviour identical. **Abstraction check:** this IS the extraction — the daemon route would be the second full copy of attempt-closing logic; extract at second occurrence (Core §5.5, same Bounded Context). TDD: existing dispatch suite is the invariant and must pass unchanged. Pull Gate: G0-4 verify chain green. Unblocks G1-1-T2.
- **G1-1-T2** (FEATURE, Sonnet): daemon fail path → Finalizer. Server-authoritative retry per R3 (ASSUMED — confirm): reuse step `maxRetries`/`retryDelayMs` exactly as the HTTP path does; exhaustion → dead-letter + notification; daemon `willRetry` logged, not obeyed. ADR-0008. Tests first (retry ladder, exhaustion, hint-ignored). Pull Gate: T1 landed, HTTP suite green. Unblocks G1-1-T3.
- **G1-1-T3** (FEATURE, Sonnet): **Execution Payload v2** — server runs `resolvePrompt` over instructions/systemPrompt, adds `previousOutput`, bumps `payloadVersion: 2`; daemon `validateExecutionPayload` updated; contract tested both directions; snapshot `snapshots/daemon-execution-payload.md` → Version 2 (R2, ASSUMED shape — confirm). Pull Gate: snapshot v1 semantics re-read and still hold (verified 2026-07-10). Unblocks G1-1-T4.
- **G1-1-T4** (FEATURE, Sonnet): StepExecution row per daemon attempt — created at lease (daemon-dispatch), finalized by the Finalizer; cost/turns/session_id move from the JSON artifact into StepExecution.cost/tokensUsed (artifact kept for evidence); `startedAt` stamped (closes that part of 1.7). No schema change expected (model exists for HTTP — verified schema use); if one becomes necessary: migration + rollback + flag per BB rule 6. Closes TD-018b. Pull Gate: G1-1-T3 landed + suite green. Unblocks G1-1-T5.
- **G1-1-T5** (FEATURE, Sonnet): extend `smoke:daemon` with parity checks: resolved-token assertion, forced-fail → retry → dead-letter chip visible, StepExecution row + cost present, budget pause on daemon-only spend. **EPIC smoke.** Pull Gate: G1-1-T4 landed + suite green. Unblocks G1-2. END OF STORY.

**G1-2 — Review-rejection feedback reaches daemon agents.** (traces: 1.3; Priority **H** — a rewound step re-running the identical prompt makes review gates useless for daemon chains)
As a **reviewer**, I want my rejection note delivered to the daemon agent's next attempt, so the re-run can actually address the feedback.
AC: Given a review gate rejects with a note and the chain rewinds, When the daemon leases the re-run, Then the payload carries the rejection note in the same position the HTTP path injects it (dispatch.ts:296-300 per gap — ASSUMED refs); Given no rejection, Then the field is absent (payload v2 optional field, no version bump).
Test expectations: route test (rejection present/absent), fake-CLI e2e assert the note reaches stdin.
Size: S (one task). INVEST ✓. DoR: READY (after G1-1).
- **G1-2-T1** (FEATURE, Sonnet): rejectionNote in payload + daemon prompt composition + tests. Pull Gate: payload v2 snapshot current. Unblocks G1-3. END OF STORY.

**G1-3 — MCP tools for daemon agents.** (traces: 1.6; Priority **M** — "blocks production (for MCP users)" per gap; a no-op for installs without MCP)
AC (per A13, ASSUMED — confirm): Given an agent with `mcpConnectionIds` and the claude runner, When the step spawns, Then a generated MCP config (from the server-side MCP connection defs, secrets via env indirection — never in the payload or argv) is passed via `--mcp-config`; Given the generic runner, Then MCP is documented unsupported and the step proceeds without it (no silent pretend).
Test expectations: config-generation unit tests (secret-free payload assertion), spike findings note.
Size: S (spike + one task). INVEST: ✓ with a note — value hinges on A13; the spike de-risks it. DoR: READY for the spike; T1 HOLD until spike GO + A13 confirmed.
- **G1-3-T0** (Hat: PREPARATORY (SPIKE, timebox S), Opus — judgment): validate claude CLI MCP flags/config format headlessly on the dev host; deliverable: findings + go/no-go for T1. Pull Gate: G1-2-T1 landed + suite green. Unblocks G1-3-T1. **DONE 2026-07-13 — GO** (`state/spike-g1-3-mcp-config.md`, ~$0.08 spend; A13 confirmed; the two silent-degradation traps found — unset `${VAR}` passthrough, broken-server silent no-tools — are promoted to T1 ACs).
- **G1-3-T1** (FEATURE, Sonnet): implement per spike; docs for generic runner. Pull Gate: spike GO ✓. **DONE 2026-07-13 (commit cfc22d4)** — `daemon-mcp-config.ts` (sanitized fragment, project-scoped, secret guard) → payload `mcp` field; daemon env-var pre-validation, temp config + `--mcp-config --strict-mcp-config --allowedTools`, init-status "failed" detection; template/echo documented unsupported. END OF STORY.

**G1-4 — Remaining parity bundle.** (traces: 1.7 minus startedAt (done in G1-1-T4); Priority **M** — gap file itself rates these "polish (bundle with above)")
AC (three independent blocks): fallback-agent escalation applies to daemon terminal failures via the Finalizer (same rules as HTTP, dispatch.ts:537-558 per gap — ASSUMED refs); `agent.maxConcurrent` enforced at daemon lease time; projectMode instructions/outputFormat included in payload composition (payload addition — optional fields, no version bump).
Test expectations: unit per block; e2e only for fallback (reuses smoke harness).
Size: M (one task, three independent blocks). INVEST: I bent deliberately — three small parity items bundled per the gap file's "bundle with above". DoR: READY (after G1-1).
- **G1-4-T1** (FEATURE, Sonnet): the three parity items + tests. Pull Gate: Finalizer stable (G1-1 suite green). Unblocks G1-5. END OF STORY.

**G1-5 — EPIC close-out.** (traces: EPIC hygiene per Core §4; Priority **M** — context compression keeps later EPICs executable in ≤3k tokens)
Size: S (one task). INVEST: task-type work item — hygiene, no persona/user value by design. DoR: READY (after G1-4).
- **G1-5-T1** (PREPARATORY, Haiku): snapshot v2 final, runbook caveat removal, TD-018b/TD-025 → Resolved in TECHNICAL_DEBT.md, phase summary + architecture-memory update. Pull Gate: G1-4-T1 landed + suite green. **DONE 2026-07-13** — snapshot final (G1-2/3/4 fields), runbook caveats swept (daemon-step-stuck, budget-pause-recovery), TD register was already current, `phase-summary-epic-G1.md` written (retro included), architecture-memory updated. END OF STORY / **END OF EPIC G1** (T5 smoke carried to a Linux-host session) → expand G2 (if A12 met) and G3.

---

### EPIC G2 — Proven Deploy (story-level; expand after G1 retro + A12)

- **Objective:** a built, healthy, e2e-tested container artifact with a safe schema-change path — no data-loss flags, no never-run deploy code.
- **Mode: DELIVERY** — G2-1 introduces new architecture (two-lane prisma migrate, ADR-0009); Core §1 forbids architectural change in HARDENING. G2-2/3/4 are verification/TD-servicing work executed under DELIVERY governance with REFACTORING/PREPARATORY hats. Rollback verified before each task (retained from the HARDENING draft).
- **EXTERNAL DEPENDENCY:** a Linux/Docker host (A12) — the dev host is Windows without Docker (verified, A9 + TD-024). **G2-2 is NOT blocked** and may run any time after G0.
- **Business Value (ASSUMED — confirm):** deploy claims become true; protects user data on upgrade. Metric: TD-024 resolved; `--accept-data-loss` gone; e2e green against the artifact.
- **SLO:** Deploy — `docker compose up --build` to healthy `/api/health` < 15 min on a clean host.
- **Risk:** **HIGH (R4)** — migration adoption under the hardcoded-sqlite provider (ADR-0004, verified). R4 approach confirmed by owner 2026-07-10; mitigation still REQUIRED before G2-1: the design artifact itself (ADR-0009 draft) must be produced and reviewed before G2-1 starts. **The hard gate stands.**
- **Smoke:** compose up --build → seeded walkthrough smoke passes against the container.
- **ADRs:** ADR-0009 "Schema evolution: prisma migrate two-lane" (NEW); amend ADR-0004.
- **Runbook:** extended at story expansion.

Stories (tasks sketched; full decomposition at expansion):
- **G2-1 — Adopt `prisma migrate`; remove `--accept-data-loss`.** (traces: 1.9, 1.10 — both verified: flag at docker-entrypoint.sh:21; no prisma/migrations dir exists) Priority **H** — silent column/data drop on image upgrade is the worst failure mode in the list. Design (R4 — approach confirmed 2026-07-10; ADR-0009 draft still gates the start): Migration Baseline per provider lane (sqlite lane generated normally; PG lane via `migrate diff` against a PG shadow), entrypoint runs `migrate deploy`, pgvector column moves from hand-run init-pgvector.sql into the PG lane (also fixes 1.10's silent-degrade tail). Rollback: entrypoint refuses to start on failed migration (never destructive fallback). Test expectations: migration applies on empty AND on a copied live SQLite db; divergence test proves refusal instead of loss.
- **G2-2 — SQLite WAL + busy_timeout.** (traces: 1.12; also fixes the INSTALL.md WAL-files doc bug from Tier 3) Priority **M** — second-process access (doctor vs live server) currently hits SQLITE_BUSY. Not blocked by A12. Test expectations: concurrent doctor-against-live-server passes; WAL files exist and INSTALL.md describes reality.
- **G2-3 — Build and verify the images.** (traces: 1.8, TD-024; folds **2.8** — compose PG hardcoded password + published 5432, same file) Priority **H** — the artifact has literally never existed. AC: Debian better-sqlite3 compile, standalone tracing completeness, in-container migrate deploy, `/api/health` 200, board-ws `/healthz` reachable (checklist from HANDOFF, verified); compose PG password required-from-env + port unpublished by default. Integrity rule (retained from the HARDENING draft): do NOT fake a pass without the host (HANDOFF, verified).
- **G2-4 — E2E against the built artifact.** (traces: 1.11) Priority **M** — Playwright currently targets `bun run dev` only (per gap, playwright.config.ts:6-9 — ASSUMED refs). AC: e2e profile pointing at the container URL; runs on the Docker host; recorded as the deploy gate. END OF EPIC → retro; unblocks plan-EPIC-G G-5 1.0 cut.

---

### EPIC G3 — Truth in Features (EXPANDED 2026-07-13 after G1 retro; tasks below each story)

> Expansion notes (2026-07-13): **A12 is now indefinitely unmet — owner confirmed no
> Linux/Docker host is available**, so G2 stays parked (G2-2 WAL pragmas excepted,
> folded into G3-7 close-out as an opportunistic Windows-runnable item). Consequence
> for this EPIC: **additive nullable columns via `db push` remain acceptable**
> (existing A–F precedent, non-destructive), but **new tables stay gated on a
> migration story** → G3-5 is HOLD with an explicit owner decision recorded on its
> line. Execution order: G3-1 → G3-2 → G3-3 → G3-4 → G3-6 → G3-7 (smoke + close-out);
> G3-5 HOLD.

- **Objective:** every README/help claim either works or is removed — skills agents can consume, semantic search that searches, spec-compliant authed MCP, cross-project KPIs, durable reactions.
- **Mode: DELIVERY** — new feature work (the "implement" arm of R7) on the validated architecture; TDD mandatory.
- **Business Value (ASSUMED — confirm):** trust — the gap file's track (D); also the stated precondition for seeding the prompt-engineering kit as skills content (gap §sequencing item 4). Metric: README claim audit finds 0 claims without a code path.
- **Risk:** MED — G3-3 (MCP) has spec-surface creep. Mitigation: scope to initialize handshake + session header + streamable-HTTP + auth from `config`; stdio explicitly out of scope v1 (ASSUMED — confirm).
- **SLO:** MCP tool call — handshake/auth failure rate < 5% over 7d (measurable on the delivered surface). The original Reactions SLO (delivery loss on restart = 0) moves with G3-5 and applies only if it un-HOLDs.
- **Smoke:** one agent run consumes a skill, calls an authed MCP tool, and its project appears in the cross-project Rollup — single scripted pass.
- **ADRs:** ADR-0010 "Skill consumption model"; ADR-0011 "Reaction Outbox".
- **Runbook:** two entries land with their stories — "MCP handshake/auth failure triage" (G3-3-T2) and "skill-injection cap exceeded" (G3-1-T1).
- **Feature flags (critic finding 5, resolved):** G3-3-T1 gets a real kill-switch (`MCP_LEGACY_TRANSPORT=1` env reverts to the raw JSON-RPC client for one release; removal = TD item). G3-1 and G3-4 carry recorded WAIVERS: skills injection is inert until an operator attaches a skill (the attach IS the flag), and the Rollup is an additive read-only view — no behavior change to existing surfaces.

Stories (implement/de-claim per R7 — default choices CONFIRMED by owner 2026-07-10):

**G3-1 — Agents consume skills.** (traces: 1.13 — verified: `resolvePrompt` has no skill source; /api/skills is session-auth only) Priority **H** — headline README claim, and the prompt-kit seeding precondition. Journey (ASSUMED): operator attaches skills to an agent (or agent-level auto-match), dispatch injects matched skill content into the prompt via a `{{skills}}` token/section with a size cap. Test expectations: resolve-prompt unit tests + an e2e where removing the skill changes the composed prompt.
- **G3-1-T0** (Hat: PREPARATORY, Opus — judgment): **ADR-0010 "Skill consumption model"** — decide attach mechanism (proposal: explicit `Agent.skillIds` nullable JSON column, additive `db push` per expansion note — mirrors `mcpConnectionIds`), injection point (inside `buildResolvedPrompt` so the DAEMON path gets it free — abstraction check: same pattern as memory), token/`{{skills}}` section semantics, size cap + truncation marker. Deliverable: the ADR. Pull Gate: none. Unblocks T1.
- **G3-1-T1** (FEATURE, Sonnet): schema column + contracts + agent CRUD accept `skillIds`; `buildResolvedPrompt` loads attached skills and injects per ADR-0010 with the cap; tests: resolve-prompt units (skill present/absent/capped) + daemon payload carries the injected prompt (route test extension). Pull Gate: ADR-0010 accepted. Unblocks T2. Size M.
- **G3-1-T2** (FEATURE, Sonnet): agent editor UI — skill attach picker + attached-skill chips; README/help wording aligned to what shipped. Tests: the story e2e lands HERE — attach a skill, assert the composed prompt contains it, detach, assert it's gone (API-level e2e, no browser needed). Pull Gate: T1 green. END OF STORY. Size S.

**G3-2 — Semantic skill search tells the truth.** (traces: 1.14, 1.15) Priority **M** — premium config (PG+pgvector) currently returns 0 rows forever (**no skill ROW is ever embedded on save** — the search route already embeds the query via `embeddings.generateEmbedding`, but nothing writes skill embeddings; claim corrected per critic 2026-07-13). AC: embed-on-save (+ backfill script); CRUD completed (get/update/delete); "versioning" de-claimed from UI/help (schema field stays, unused — recorded as a TD item) per R7. Test expectations: PG-path search returns the seeded skill; SQLite fallback unchanged.
- **G3-2-T1** (FEATURE, Sonnet): embed-on-save for skill create/update (reuse the existing `embeddings.generateEmbedding` — already shared with memory.ts and the search route; no extraction needed) + `scripts/backfill-skill-embeddings.ts`; tests: embed called on save, PG search query shape returns seeded skill (mocked PG), SQLite substring fallback unchanged. Pull Gate: G3-1 landed (shared skill fixtures). Unblocks T2. Size M.
- **G3-2-T2** (FEATURE, Sonnet): complete skills CRUD — GET one / PUT / DELETE routes + contracts (the unused `updateSkillSchema` finally consumed) + skills page wiring; de-claim "versioning" in UI/help; **TD item: Skill.version schema field unused**. Pull Gate: T1 green. END OF STORY. Size M.

**G3-3 — MCP client: handshake + auth + SSRF.** (traces: 1.17, **2.3**) Priority **H** — no-auth spoofing surface + the cosmetic Type dropdown is a trust break. AC: initialize handshake, session headers, streamable-HTTP, auth read from the `config` column (never logged, never in payloads), `isSafeExternalUrl` applied (parity with adapters/webhook.ts per gap). Pre-split: T-transport / T-auth+SSRF. Test expectations: contract tests against a local mock MCP server incl. auth-required and SSRF-blocked cases.
- **G3-3-T1** (FEATURE, Opus — protocol judgment): spec-MCP transport in `mcp-resolver.ts` — initialize handshake (+ protocolVersion negotiation), `Mcp-Session-Id` header, streamable-HTTP POST; **scope guard: no stdio, no legacy SSE (v1)**; Type dropdown becomes real (`http` transport; unknown legacy values → clear error, not silence). **Kill-switch: `MCP_LEGACY_TRANSPORT=1` reverts to the raw JSON-RPC client for one release (TD item on removal).** Contract tests against a local mock MCP HTTP server (reuse the G1-3 spike fixture pattern over HTTP). Pull Gate: G3-2 landed. Unblocks T2. Size L — split into ST-handshake / ST-tools-call if it crowds the budget.
- **G3-3-T2** (FEATURE, Sonnet): auth headers from `config.headers` with **env-name indirection — reuse the `daemon-mcp-config.ts` template convention (abstraction check: extract the shared header-template validator), server-side expansion at request time, never logged, never exported**; `isSafeExternalUrl` on every MCP fetch (parity with adapters/webhook.ts — closes gap 2.3). Tests: auth-required mock (401 without/200 with), SSRF-blocked private-range cases, secret-absent-from-logs assertion. Pull Gate: T1 green. END OF STORY. Size M.

**G3-4 — Cross-project Rollup KPIs.** (traces: 1.16) Priority **M** — help docs promise it; analytics is per-project only. AC (ASSUMED journey): a Rollup view aggregates cycle time, review wait, rejection rate, cost/task across projects the session can see; help text matches what's computed, nothing more.
- **G3-4-T1** (FEATURE, Sonnet): `/api/analytics/rollup` — aggregate cycle time, review wait, rejection rate, cost/task across session-visible projects (session-auth; per-project rows + totals). **KPI definitions bind to the existing per-project analytics queries (observability dashboard) — same timestamps, same denominators; if a KPI has no per-project precedent, define it in the task with the exact fields (cycle time = task createdAt→DONE transition; review wait = REVIEW entry→sign-off; rejection rate = rejected/total sign-offs; cost/task = Σ StepExecution.cost / tasks completed) and mirror those definitions into help.** Unit tests on the aggregation math incl. empty/zero-task projects. Pull Gate: G3-3 landed. Unblocks T2. Size M.
- **G3-4-T2** (FEATURE, Sonnet): Rollup view (observability area) + help-content rewritten to promise exactly the four computed KPIs, nothing more. Tests: render assertion + help-text-matches-computed-KPIs check. Pull Gate: T1 green. END OF STORY. Size S.

**G3-5 — Reaction Outbox. HOLD (schema gate).** (traces: 1.18) Priority **M** — process death currently loses deliveries silently. AC: reactions enqueue Outbox rows; scheduler drains with retry/backoff; chain no longer stops at first failing reaction; board surfaces failed deliveries. Idempotency: delivery key per (reaction, event). Schema change (NEW TABLE) → BB rule 6 wants migration + rollback + flag; the migrate lane (G2-1) is A12-blocked indefinitely (owner 2026-07-13: no Linux/Docker host). **OWNER DECISION NEEDED to un-HOLD: either (a) accept the Outbox table via `db push` like all prior schema (waives rule 6 for this table, recorded as TD), or (b) do G2-1's SQLite-lane-only migrate adoption first (PG lane deferred with A12).** Expansion deferred until decided.

**G3-6 — Doc-truth sweep.** (traces: Tier 3 bullets: live-cursors/queue-view de-claim, .env.example omissions, wizard prerequisite errors surfaced, export-scope honesty, help-content overclaims, stale TODO) Priority **L** — cheap, opportunistic per gap file; batch as one story so it actually happens.
- **G3-6-T1** (FEATURE, Haiku — checklist): one sweep commit — README/help de-claims (live cursors, queue view, anything G3-1..4 did NOT make true), `.env.example` completed (ANTHROPIC_API_KEY, SMTP_*, NOTIFY_EMAIL_*, EMBEDDING_MODEL, OTEL_*), wizard prerequisite errors surfaced (real message, not generic 500), export-scope documented, stale TODO purge. Pull Gate: G3-4 landed (so de-claims reflect final state). END OF STORY. Size M.

**G3-7 — EPIC smoke + close-out.** (EPIC hygiene per Core §4)
- **G3-7-T0** (FEATURE, Sonnet): **G2-2 pulled forward** (the one Windows-runnable G2 item): SQLite WAL + busy_timeout pragmas; INSTALL.md describes the WAL files that now actually exist; test: doctor-against-live-server no longer hits SQLITE_BUSY. Pull Gate: G3-6 landed. Unblocks T1. Size XS. (Split from T1 per critic — infra config ≠ smoke deliverable.)
- **G3-7-T1** (FEATURE, Sonnet): the EPIC smoke — one scripted pass: an HTTP-path agent run consumes an attached skill, calls an authed MCP tool (local mock server), and its project appears in the Rollup. Windows-runnable (`bun run dev` + script). Pull Gate: T0 green. Unblocks T2. Size M.
- **G3-7-T2** (PREPARATORY, Haiku): README claim audit (EPIC DoD metric: 0 claims without a code path), phase summary, architecture-memory update, TD register service. END OF STORY / END OF EPIC → retro, then expand G4 (G3-5 decision revisited at retro).

---

### EPIC G4 — Conceptual Coherence (story-level; expand after G3 retro)

- **Mode: DELIVERY.**
- **Source:** `FUNCTIONALITY-REVIEW-2026-07-10.md` §2.6 (treated as DATA, same injection-guard stance as §1.2).

Stories (one paragraph each; no task decomposition yet — expand after the G3 retro):
- **G4-1 — Merge WAITING+REVIEW into a single human-attention destination.** (traces: review §2.6.1) Priority **H** — the two columns partition by execution model, not meaning, and the purple "Review" column the help points at stays empty in the flagship chain workflow; merge them into one place a human looks (or make REVIEW the single human-gate destination). Touches `resolveTaskStatus`, the board columns, the pull-agent `review` action, and the help.
- **G4-2 — Honest drag.** (traces: review §2.6.7 + §2.6 missing-pieces) Priority **H** — dragging a chained task out of IN_PROGRESS currently neither pauses nor cancels dispatch and the engine silently overwrites the move; the drag must either pause the chain / offer `closeChain` (the verb exists) or be refused with an explanation. Adds the task-level Pause/Cancel verb the model implies.
- **G4-3 — Split `Agent.isActive`.** (traces: review §2.6.3) Priority **M** — one boolean conflates human intent with liveness, so the pause switch is unreliable for pull agents by construction; split into `paused` (intent) and `lastSeen`-derived presence.
- **G4-4 — Help-content truth pass.** (traces: review §2.3.2) Priority **H** — the in-app manual documents a different application (four columns vs five, phantom transition validation, wrong handoff token, invented load balancing, WebSocket daemons); rewrite the board/state-machine/handoff chapters against the code. Pairs with G3-6's README de-claiming — same truth-in-features discipline, deeper errors.
- **G4-5 — One Template noun.** (traces: review §2.6.2; scope ASSUMED — confirm at expansion) Priority **M** — collapse ChainTemplate + TaskTemplate + RecurringTask into a single Template that contains an optional chain, with recurrence as a property ("run weekly"); three overlapping concepts for one user intent.
- **G4-6 — Cut or commit to Workspaces.** (traces: review §2.6.4; scope ASSUMED — confirm at expansion) Priority **M** — the switcher visibly does nothing (it scopes only the Skills page) while being invisibly load-bearing for daemon dispatch; either finish workspaces (filter projects, scope settings) or demote them to an invisible routing detail. END OF EPIC → retro.

---

### Tier-2 fold-in — extends plan-EPIC-G story G-3 "security re-review"

- **Mode: HARDENING** — security-only, no features; per the gap file these fold into "the security re-review EPIC G already plans" (dev-plan G-3, whose first tranche is in-flight uncommitted — G0-0 lands it).
- **Priority default M** — gap file: "none block basic use; several matter before multi-user production". Sequence after G1; GS-1/GS-2 first if multi-user arrives sooner.
- **SLO/Smoke/Runbook:** inherits plan-EPIC-G's.
- **Dedupe status (verified on disk 2026-07-10):** 2.4's purge script (`scripts/purge-legacy-keys.ts` + legacy-key-purge.ts + test) and a LOGIN rate limiter exist uncommitted. 2.5 targets `/api/auth/reset/request` — a DIFFERENT endpoint; not covered by the in-flight work. Re-check each item after G0-0 commits.

Stories (story-level; expand at pull time):
- **GS-1 — Admin-role enforcement on key issuance.** (traces: 2.1) `requireRole('admin')` on scoped-key mint/revoke + agent key rotation; test: member session → 403. Priority **M** — privilege escalation, but single-operator today (A1).
- **GS-2 — Same-origin assertion sweep.** (traces: 2.2) `assertSameOrigin` on the cookie-auth mutating routes that lack it (gap counts 32; 22 route files currently reference it — verified count, set-difference at expansion). Test: shared route-table test asserting every cookie-auth mutation is covered (fitness function, P7). Priority **M**.
- **GS-3 — Legacy credential sunset.** (traces: 2.4, 2.6) Purge run wired as a gate (doctor check or boot warning→refusal per owner choice) + unbound scoped keys get a sunset: warn → reject after a dated flag. Priority **M**. Pull gate: G0-0 committed the purge tooling.
- **GS-4 — Rate-limit password-reset requests.** (traces: 2.5) Reuse the in-flight login-rate-limit mechanism for `/api/auth/reset/request`; test: N+1th request 429, no email sent. **Abstraction check:** second consumer of the limiter — extract a shared limiter utility now (Rule of Three bent deliberately: same Bounded Context, identical mechanics). Priority **M** — only exploitable on SMTP-configured installs. At expansion: split the shared-limiter extraction into a PREPARATORY task (Two Hats).
- **GS-5 — Session-signing secret separation.** (traces: 2.7) Dedicated `SESSION_SECRET` env (generated on first boot or required), never defaulting to the admin password; migration note for existing sessions (re-login acceptable per A8). Priority **M**.
- **GS-6 — WS reconnect + resync.** (traces: 2.9, touches TD-023 context) Unlimited backoff-capped reconnect + on-reconnect state resync (refetch project or event replay — design at expansion). Priority **M** — silent staleness is a trust bug (track C theme). At expansion: justify as defect repair of gap 2.9 (reconnect gives up + no resync), not new feature. END OF FOLD-IN.

---

## 5. Validator Summary (BB §9, structure + quality pass — full validator to run as the separate critic pass per CLAUDE.md: backlog-critic-agent)

**Validation status:** Validated 2026-07-10 (separate critic pass): verdict FIX → fixes applied same day; owner approved 2026-07-10; execution started at G0. Findings: 3 IMPORTANT (pull-gate completeness, G2 mode, DoR conformance) + 6 MINOR — all applied.

- Structure: DAG ✓ (G0 → G1 → {G2 ext-dep A12, G3, GS}; G2-2 early-eligible; G3-5 pull-gates on G2-1). DEVIATION (recorded): BB §3 rule 2 tracer-bullet-first is not applied — G0 must first repair the gates that make any DoD verifiable; G1-1 is the mandated end-to-end-first slice. Every specified task has Unblocks + Pull Gate ✓ (fixed 2026-07-10 critic pass: 6 missing Pull Gates added; the G0→G1 Unblocks edge moved from optional G0-4-T2 onto G0-4-T1). Token budgets ≤15k est., G3-3 pre-split ✓.
- Quality: G1 stories carry Size/INVEST/DoR lines (G1-3-T1 HOLD pending spike + A13); G0-1/G0-2 are explicit task-type work items (no persona); other G0 stories DoR-READY; G2/G3/GS HOLD-until-expansion by design (BB rule 4) ✓. Hats declared on all specified tasks ✓. TDD order stated (DELIVERY/HARDENING) ✓. Two Hats: Finalizer extraction (G1-1-T1 PREPARATORY) strictly precedes behaviour change (T2) ✓. Glossary consistent (Finalizer/Outbox/Rollup/Migration Baseline) ✓. ADRs: 0007–0011 named ✓.
- Testing: critical paths — Finalizer inherits the 94.7%-covered dispatch suite as invariant; fake-CLI daemon suite extended; contract tests both directions on payload v2; schema changes (G2-1, G3-5) carry migration + rollback + flag ✓. E2E smoke per EPIC ✓ (G0-4, G1-1-T5, G2 compose-smoke, G3 scripted pass).
- Risk & Debt: HIGH risk R4 has a confirm-before-execution mitigation gate (G2-1 blocked on it) ✓; every de-claim/shortcut lands as a TD item (G3-2 versioning; A11 protocol break noted) ✓. Assumptions A10–A13 ledgered ✓.
- Operations: SLOs per EPIC ✓; runbooks extended (G0 gates, G1 epic-A runbook, G2 deploy) ✓; feature flags on schema-bearing user-facing changes ✓; idempotency: lease/attempt keys (G1), delivery keys (G3-5) ✓.
- Economics: no task spec longer than its expected output (G0-1-T1 is the floor case — one tsconfig line + a negative test; kept because it repairs a gate, not bureaucracy) ✓; G2/G3/GS deliberately not over-decomposed ✓.

**Next action:** G0-0-T1 (reconcile the tree) — then G0 straight through. §1.1 confirm list cleared by owner 2026-07-10 ("ok go for it"); execution started at G0. R4 remains the one live gate: approach confirmed, but the ADR-0009 draft must be produced and reviewed before any G2-1 work.
