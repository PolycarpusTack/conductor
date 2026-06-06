# Agent Library Import + Agent Presentation Overhaul

Bring the C:\Projects\ClaudeExtras agent suites and chain catalog into Conductor
as a **bundled, importable library** — and make 100+ agents per project usable
with categories, grouping, and search.

**Verified against the source 2026-06-06:**
- `YannickAgents.zip` holds 123 Claude-style agent defs (frontmatter name/
  description + system-prompt body) across 9 suites; 89 unique (the 34
  ddd-full-suite agents are duplicated inside master-suite; master adds 6
  craftsmanship-only agents).
- `api-testing-suite/agents/all-agents.md` defines 5 more agents as `ROLE:`
  prompt blocks; `core/` has gpm-partner + backlog-builder +
  current-state-evaluator (frontmatter) and output-evaluation-prompt (plain).
- `agent-chain-catalog.md` (20 chains, section 3 splits into 3a/3b/3c) +
  suite5 patch (3 new) + suite8 patch (4 new) reference agents by slug, with
  per-step `← "instruction"` annotations. Some chains run 13 steps —
  `chainTemplateStepSchema` caps at 10 today and must be raised.
- Conductor mapping: agent slug → `Agent.role` (so chain-template `agentRole`
  steps resolve via the existing role-resolution paths: recurring runner,
  task:assign rules); suite → new `Agent.category`; body → `systemPrompt`.

## Task 1 — Converter + bundled library artifact

- [x] `scripts/convert-agent-library.py`: reads ClaudeExtras (zip + catalog
  files + api-testing + core), dedupes by slug (ddd wins over master for
  category; master-only 6 → Craftsmanship), maps suite → category with
  per-category emoji/color, parses all chain sources into ChainTemplate-shaped
  steps (`agentRole`, heuristic mode by slug suffix: reviewer/guard/auditor/
  detector/evaluator/enforcer → review; generator/builder/gen/recorder →
  draft; else analyze), validates every referenced slug exists, and emits
  `src/lib/server/agent-library/library.json`.
- [x] Run it; eyeball the artifact (agent/chain counts, unknown-slug report).

## Task 2 — Server: schema, contracts, import routes (TDD)

- [x] `Agent.category String?`; push + generate.
- [x] `chainTemplateStepSchema` steps cap 10 → 25 (and the task-create steps
  cap if it would block instantiating the longest chain).
- [x] `agent-library.ts`: `loadLibrary()` (cached), summary + import helpers.
- [x] `GET /api/agent-library` (admin): categories with counts + agent
  summaries + chain summaries. `POST /api/projects/[id]/agent-library/import`
  `{ categories?: string[], chains?: boolean }`: creates agents
  (skip existing by name, set category/role/systemPrompt/description) and
  chain templates (skip existing by name). Returns created/skipped counts.
- [x] Tests: import idempotence, category filter, chain creation, library
  summary shape.

## Task 3 — UI: import + presentation overhaul

- [x] Agents tab: group agents by `category` (collapsible sections with
  counts, ungrouped agents under "General"), a search box filtering across
  name/role/description, and an "Import from library" panel (category
  checkboxes with counts, include-chains toggle, result toast).
- [x] Task dialog agent picker: grouped Select (category headers) so 100+
  agents stay navigable.
- [x] Help: Agents section documents the library and categories.
- [x] Full verification; commits per task.

> **Implemented 2026-06-06.** Deviations: 98 agents (not 89+5+4=98 — exact);
> 27 chains after dropping 2 degenerate (<3-step) parses; MgX/RCA chains were
> skipped entirely (they reference rca-analyst / mgx-investigation-evaluator
> prompts that exist only as paste-prompts, not agent defs). The agents tab
> was extracted into settings-agents.tsx (search + collapsible category
> groups + the import panel); per-row markup moved with it.
