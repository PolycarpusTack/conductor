# Phase Summary — EPIC G1 (Daemon Parity)

Date: 2026-07-13. Commits `6961f2c..cfc22d4` (+ docs/state commits). Traces:
GAP-ANALYSIS-2026-07-10 Tier 1A (gaps 1.1–1.7), backlog G1-1..G1-5.

## What was built

The DAEMON execution path — the headline "local AI coding agent" path — was a
second-class citizen that skipped roughly half the engine's bookkeeping. It now
has correctness parity with HTTP dispatch:

- **G1-1-T1** — extracted the shared **Finalizer** (`finalizeStepSuccess`/
  `finalizeStepFailure` in `dispatch.ts`); HTTP rewired onto it, zero behavior
  change (94.7%-covered dispatch suite as the invariant).
- **G1-1-T2** — daemon fail path routes through the Finalizer (**ADR-0008**):
  server-authoritative retry/backoff, dead-letter + notification on exhaustion,
  fallback escalation; daemon `willRetry` demoted to a logged hint. Closes
  **TD-025**, gaps 1.4/1.5.
- **G1-1-T3** — Execution Payload **v2**: `buildResolvedPrompt` extracted and
  shared, so the daemon receives server-resolved prompts (no literal
  `{{tokens}}`, gap 1.1) + `previousOutput` chain context (gap 1.2).
- **G1-1-T4** — `StepExecution` row per daemon attempt (poll-time create,
  completion-time finalize, cost lifted from the `claude run metadata`
  artifact, `startedAt` stamped). Budgets bind daemon spend. Closes **TD-018b**.
- **G1-2** — review-rejection notes reach daemon agents (`rejectionNote` in the
  payload; same HUMAN-FEEDBACK block as HTTP). Gap 1.3.
- **G1-4** — remaining parity bundle (gap 1.7): fallback verified on the daemon
  path **plus a real fix** — `findOrCreateRunningExecution` stops a
  post-fallback re-run from resurrecting/overwriting the failed agent's
  terminal execution rows; `agent.maxConcurrent` enforced at daemon lease time;
  server-layered `modeInstructions` (projectMode instructions + outputFormat)
  in the payload.
- **G1-3** — MCP tools for daemon agents (gap 1.6): spike T0 validated
  `--mcp-config` headlessly (`spike-g1-3-mcp-config.md`, A13 confirmed), then
  `daemon-mcp-config.ts` ships a sanitized `mcpServers` fragment (secrets via
  `${ENV_VAR}` indirection only; literal credentials refused via
  `configError`); the daemon validates env vars pre-spawn, passes
  `--mcp-config --strict-mcp-config --allowedTools`, and fails the step when a
  promised server reports init status `failed`.

## What was learned (findings that reshaped the work)

- **The claude CLI silently degrades twice** (spike G1-3-T0): an unset `${VAR}`
  in MCP config passes through as a literal, and a broken MCP server yields a
  *successful* run with zero tools. Both became explicit daemon-side guards —
  "no silent pretend" needed active enforcement, not just config passing.
- **Attempt-number lookup is not identity** (G1-4): the daemon derived
  execution rows from `step.attempts + 1`, which restarts after fallback resets
  `attempts` — reusing a terminal row and rewriting history. The invariant that
  works: *the current run's row is the latest row iff it is still `running`*.
- **On the daemon path, MCP is spec-correct for free**: the spawned CLI is a
  real spec-MCP client talking to servers directly, bypassing Conductor's
  non-spec `mcp-resolver` (gap 1.17) entirely. The daemon path now has *better*
  MCP fidelity than the HTTP path until G3 fixes the resolver.
- **HTTP-path mode-instruction injection is token-gated** (`{{mode.instructions}}`
  in the agent's system prompt), while the daemon appends unconditionally — a
  pre-existing asymmetry documented, not widened; the daemon now at least
  appends the *correctly layered* string.

## Plan deviations

- **G1-1-T5 (daemon e2e smoke) SKIPPED** — blocked on a pre-existing daemon
  run-loop issue (step served but never completed; ~3.5 min/iteration on this
  Windows host). All parity work is unit-verified; the e2e proof + parity
  assertions (resolved tokens, dead-letter, StepExecution/cost, budget pause)
  remain specified in HANDOFF §T5 for a faster/Linux host session.
- G1-4 executed before G1-3 (RESUME-planned: unit-testable work first while the
  spike's claude-binary dependency was unconfirmed) — no dependency violated.
- G1-3-T1 scoped `configError` failures to the **claude runner only** after
  re-reading the AC ("generic runner … proceeds without it").

## Debt

- Resolved this EPIC: **TD-018b**, **TD-025** (register updated in G1-1;
  runbook caveats swept in this close-out).
- Carried, unchanged: TD-024 (Docker unbuilt — G2), TD-014b harness note
  (deterministic since 2026-07-13; spawn tests still slow under load).
- New, small: generic/template runner steps record StepExecution rows without
  cost (nothing to lift) — noted in budget-pause-recovery.md; acceptable until
  a generic cost channel exists.

## Retro (flow)

- 8 tasks across 5 stories, one-at-a-time (solo session, no subagent fan-out);
  commit per task, verify (affected suites + type-check) before each commit.
- Rework: 1 (G1-3-T1 configError placement corrected against the AC before
  commit). Suite 842 → 855+ green; type-check clean throughout.
- Spike spend ~$0.16 total across A-0-style live probes (T0 $0.08).
- Next: **retro → expand G2 "proven deploy"** (blocked on A12 Docker/Linux
  host except G2-2 WAL pragmas) **and G3 "truth in features"**; G1-1-T5 smoke
  on the Linux host alongside G2.
