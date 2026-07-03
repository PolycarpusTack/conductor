# GPM Deployment Kit v1.0 — Files, Structure, Wiring, Delegation

> **Depends on:** every document it deploys; canonical list in §1.
> **Use this when:** installing the GPM pipeline into a repo for Claude Code or ChatGPT/Codex.
> **Do NOT use for:** learning the methodology (→ README-v3 reading orders) or running the pipeline (→ the templates themselves).

Token figures below are measured (bytes/4, 2026-07-02) — estimates, not benchmarks.

---

## 1. Canonical File Manifest

| # | File | Role | ~Tokens | Loaded |
|---|---|---|---|---|
| 1 | `core-specification-v1.md` | Principles, modes, DoD, compression, economics | 4.5k | On demand, per stage |
| 2 | `gpm-v2.1.md` | Methodology: roles, phases, prompt types | 2.0k | Kickstart + execution stages |
| 3 | `backlog-builder-v5.1.md` | Design → backlog framework | 2.3k | Decomposition stage only |
| 4 | `solution-design-template-v1.md` | Pipeline front door | 2.5k | Design stage only |
| 5 | `zap-template-v3.md` | Component prompt guide | 2.0k | When authoring ZAPs |
| 6 | `cip-template-v3.md` | Integration prompt guide | 1.6k | When authoring CIPs |
| 7 | `gen-tests-template-v3.md` | Test augmentation guide | 1.2k | DELIVERY+/HARDENING only |
| 8 | `gpm-onboarding-v3.md` | Team workshop | 1.4k | Humans only — never in agent context |
| 9 | `README-v3.md` | Index + migration table | 1.7k | Humans only — never in agent context |
| 10 | `output-evaluation-prompt.md` | Per-response review | 0.7k | Paste after outputs, any provider |
| 11 | `AGENT-INDEX.md` | Library source of truth | 1.2k | Router reference; not runtime context |
| 12 | `current-state-evaluator-agent.md` | Brownfield diagnostic | 5.0k | Once per project, then its report replaces it |
| — | `Agents/` (64 subagents) | Specialists | ~1–5k each | Claude: auto by description; Codex: on demand |

Full corpus ≈ 26k tokens. **Nothing below ever loads all of it.** The design constraint: any working session carries the router (~0.5k) + the active stage's files (2–7k) + live state (Architecture Memory + snapshots, ≤3k per Core §4.4).

## 2. Directory Structure

One layout serves both providers; only the loader file differs.

```
<repo>/
├── CLAUDE.md                  ← Claude Code loader (§3) — router only
├── AGENTS.md                  ← Codex loader (§4) — router only, same content adapted
├── docs/gpm/
│   ├── README-v3.md
│   ├── core-specification-v1.md
│   ├── gpm-v2.1.md
│   ├── backlog-builder-v5.1.md
│   ├── solution-design-template-v1.md
│   ├── zap-template-v3.md
│   ├── cip-template-v3.md
│   ├── gen-tests-template-v3.md
│   ├── gpm-onboarding-v3.md
│   └── output-evaluation-prompt.md
├── docs/gpm/state/            ← the LIVING files — this is what sessions actually read
│   ├── architecture-memory.md      (Core §4.2 — updated per EPIC)
│   ├── snapshots/                  (Contract Snapshots, one file per component)
│   ├── phase-summaries/            (Core §4.3 — replaces EPIC history)
│   ├── assumptions-ledger.md
│   └── mode.md                     (one line: current mode + rationale + date)
└── .claude/agents/            ← Claude Code only: SUBSET of Agents/, not all 64
    ├── backlog-builder-policy-kernel.md
    ├── backlog-builder-annexes.md
    ├── backlog-critic-agent.md
    ├── ubiquitous-language-guard.md
    ├── two-hats-enforcer.md
    ├── tdd-practitioner.md
    └── ... (stage-relevant picks per the hook tables; ⭐ agents first)
```

**Why a subset in `.claude/agents/`:** Claude Code injects every deployed agent's frontmatter description into context permanently — 64 agents ≈ 1.5–2k tokens of standing overhead plus routing noise. Deploy the ⭐ core set plus the agents the current pipeline stage hooks (solution-design §5, BB, execution). Swap the set when the stage changes; the master library stays in `ClaudeExtras/Agents/`, the repo gets symlinks or copies.

## 3. Claude Code Loader — `CLAUDE.md` (copy-paste, ~450 tokens)

```markdown
# GPM Pipeline — Router

This repo runs the Guided Partnership Model. Rules are in docs/gpm/;
NEVER load them all — read the file for your current stage only.

## Always
- Read docs/gpm/state/mode.md first. Mode governs everything (ceremony,
  TDD, gates). If missing or stale (>1 EPIC old), ask before proceeding.
- Working context per task = architecture-memory.md + the relevant
  snapshots/ files + the task spec. Budget ≤3k tokens of project context;
  if exceeded, the memory needs updating or the task is too broad — say so.
- Every repo claim in specs is marked (verified)/(NEW)/(ASSUMED). If the
  repo contradicts a spec twice, or once on schema/interface/security:
  STOP, report expected vs observed, do not improvise.

## Stage → read
- New idea / feature request → docs/gpm/solution-design-template-v1.md
- Accepted design → decompose  → docs/gpm/backlog-builder-v5.1.md
  (agents: backlog-builder-policy-kernel + annexes; then backlog-critic-agent)
- Executing a task            → docs/gpm/gpm-v2.1.md §your-phase +
  the matching template (zap/cip/gen-tests-template)
- Anything about principles, DoD, modes, economics →
  docs/gpm/core-specification-v1.md — the single home of the rules
- Brownfield, no baseline yet → run current-state-evaluator once; its
  report then substitutes for it

## Model routing
Follow the Delegation Charter in docs/gpm/gpm-deployment-kit-v1.md §6.
Judgment → reasoning tier. Generation from clear spec → execution tier.
Checklist verification → light tier. Default down, escalate on evidence.

## After each accepted component
Write/update the Contract Snapshot in docs/gpm/state/snapshots/.
After each EPIC: update architecture-memory.md + write a phase summary.
```

## 4. Codex Loader — `AGENTS.md` (copy-paste, ~500 tokens)

Codex reads `AGENTS.md` at session start and has no subagent frontmatter mechanism, so specialists become **role blocks read on demand**:

```markdown
# GPM Pipeline — Router (Codex)

Methodology docs live in docs/gpm/. Read only your current stage's file
(stage map below). State lives in docs/gpm/state/ — read mode.md and
architecture-memory.md before any task; keep project context ≤3k tokens
(memory + relevant snapshots + task spec).

## Stage map
idea → docs/gpm/solution-design-template-v1.md
design accepted → docs/gpm/backlog-builder-v5.1.md
task execution → docs/gpm/gpm-v2.1.md + docs/gpm/{zap|cip|gen-tests}-template
rules/modes/DoD → docs/gpm/core-specification-v1.md

## Specialists
Specialist roles live in Agents/ (or ClaudeExtras/Agents/). To consult
one: read its .md file, adopt it as a role instruction for that exchange
only, then drop it. Consult at the hook points listed in the stage file.
Never hold more than 2 specialist files in context at once.

## Hard rules (from Core Spec — do not reinterpret)
- Declared TDD order: tests before implementation in modes that require it
- One Hat per task: never mix feature and refactoring
- Glossary terms exactly; shortcuts become TD Items; no calendar-day estimates
- Marks: (verified)/(NEW)/(ASSUMED) on every repo claim; numbers sourced
  or MEASURE FIRST
- Contradiction rule: repo vs spec mismatch twice, or once on
  schema/interface/security → STOP and report; never silently reconcile

## Model routing
Per the Delegation Charter (docs/gpm/gpm-deployment-kit-v1.md §6), using
this deployment's tier map. If you cannot switch models mid-session,
flag tasks whose tier differs from yours instead of executing them.
```

## 5. Token-Efficiency Rules (the actual strategy)

1. **Router, never corpus.** The loader is ≤500 tokens of pointers. Loading all 26k "to be safe" costs 50× the router on every session and buries the live state.
2. **State outranks doctrine.** `architecture-memory.md` + snapshots are the compressed truth (Core §4); a session that has them rarely needs more than one methodology file.
3. **Reports replace their generators.** The evaluator (5k) runs once; its 1-page report is what future sessions read. Same for phase summaries replacing EPIC history.
4. **Agents are paid for by description (Claude) or by read (Codex).** Claude: deploy the working subset only. Codex: read-adopt-drop, ≤2 at a time.
5. **Humans-only files stay out of agent context** (onboarding, README). They're for people; agents get the router.
6. **Snapshot discipline is the compounding saver:** referencing a 200-token snapshot instead of a 3k source file, dozens of times per EPIC, is where the budget is actually won or lost.

## 6. Delegation Charter — model routing with guardrails

**One home for delegation.** Core §6 defines the matching rule; this section makes it provider-neutral and adds the guardrails. If they ever disagree, Core §6 wins and this file gets fixed.

### Tiers (provider-neutral)

| Tier | For | Claude map | Codex/ChatGPT map |
|---|---|---|---|
| **R — Reasoning** | Judgment: solution design, architecture, trade-offs, domain modelling, backlog generation, complex debugging, adversarial review | Opus-class | Your highest-reasoning model — set once in state/mode.md |
| **X — Execution** | Generation from clear spec: code from ZAPs/CIPs, tests, migrations, docs, refactoring with known mechanics | Sonnet-class | Standard coding model |
| **V — Verification** | Checklists: DoR/DoD checks, glossary lookups, lint/format gates, snapshot generation | Haiku-class | Smallest capable model |

Fill the right column per deployment and date-stamp it — provider lineups drift faster than this document.

### Routing rules

1. **Task tier is declared at authoring time**, not chosen at execution time: the backlog builder annotates every task `Tier: R|X|V` (its existing `Model:` field, renamed provider-neutral). Undeclared → default X.
2. **Default down, escalate on evidence.** Uncertain between tiers → start X. Escalate to R only on a concrete quality failure (rework, DoD miss), and record the escalation in the retro — repeated escalations mean tasks are under-specified (GPM §5), which is fixed in prompts, not by paying for R everywhere.
3. **Never R for X-work.** R-tier on well-specified generation buys nothing and costs plenty; the Core §6 rule stands.
4. **V never writes production artifacts.** Verification tier emits PASS/FAIL + the failing items, nothing else.
5. **Stage defaults:** solution design, BB decomposition, backlog-critic → R. ZAP/CIP execution → X. Pull gates, DoR/DoD checks, snapshot extraction → V.

### Per-tier prompting patterns

- **R prompts** ask for options and consequences, never just answers: "give 2–3 options with trade-offs and a recommendation; the decision is mine." R output that contains an unrequested decision is a flag.
- **X prompts** are self-contained: full spec + snapshots + ≤3k project context, TDD order explicit, DoD stated. X should never need to explore the repo — if it does, the spec failed P11.
- **V prompts** are binary: checklist in, `PASS | FAIL: [items]` out. No prose, no suggestions, no creativity.

### Guardrails (bind these to X and V especially)

- **Stop-on-contradiction:** repo contradicts spec twice, or once on schema/interface/security → halt, report expected vs observed, options A/B/C. Never silently reconcile. (Cheaper models are most prone to confident improvisation — this rule exists for them.)
- **No invisible shortcuts:** any simplification → TD Item or it didn't happen (P4). X-tier especially: "deferred error handling" without a TD Item is a DoD failure.
- **No scope creation:** X and V never invent requirements or make architectural decisions — high-impact ambiguity goes back as `CLARIFICATION NEEDED` with options (gpm-partner behaviour, now charter-wide).
- **Escalate up, never sideways:** a stuck X-tier task goes to R or the human — not to "try a different phrasing until it passes."

## 7. Bootstrap Prompt (first session in a wired repo)

```
Read CLAUDE.md (or AGENTS.md). Then: read docs/gpm/state/mode.md and
architecture-memory.md if they exist. If they don't, this repo is
unbootstrapped — run the brownfield baseline (current-state-evaluator)
or, for greenfield, start the solution-design protocol
(docs/gpm/solution-design-template-v1.md, Turn 1). Tell me which path
applies and what you need from me.
```

---

## Provenance and maintenance
- Token figures: measured 2026-07-02 (`wc -c`/4); re-measure after any doc bump — `for f in docs/gpm/*.md; do echo "$f $(( $(wc -c <$f) /4 ))t"; done`
- Tier maps in §6: re-verify per provider quarterly; date-stamp changes in state/mode.md.
- Agent subset in §2: re-derive from AGENT-INDEX.md ⭐ marks + the active stage's hook tables whenever the stage changes.
- v1.0 — 2026-07-02.
