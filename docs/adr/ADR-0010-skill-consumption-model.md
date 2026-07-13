# ADR-0010: Skill consumption model

Status: Accepted

Date: 2026-07-13

## Context

The README claims skills are "reusable knowledge agents can pull in", but no
dispatch path reads them: `resolvePrompt` has no skill source and `/api/skills`
is session-auth only (gap 1.13). G3-1 makes the claim true. Three design
questions need answers before code:

1. **How does a skill get attached to an agent?** Skills are WORKSPACE-scoped
   (`Skill.workspaceId`); agents are PROJECT-scoped, and a project has an
   optional `workspaceId`. Any attach model must respect that boundary.
2. **How does an attached skill reach the prompt?** The existing memory pattern
   is token-gated: `{{memory.recent}}`/`{{memory.relevant}}` reach the model
   ONLY if the agent's systemPrompt template contains the token. Applied to
   skills, that recreates the exact "silent pretend" G3 exists to kill: an
   operator attaches a skill and nothing changes because the template lacks a
   token they've never heard of.
3. **What bounds the injection?** Skill bodies are markdown playbooks up to
   several KB; an unbounded join would blow the prompt budget.

## Decision

**Attach = explicit, agent-level.** New nullable column `Agent.skillIds`
(JSON string array, mirrors `Agent.mcpConnectionIds`; max 10 in contracts).
Additive `db push` per the G3 expansion note (A12 failed — no migrate lane).
Attach-time validation: every skill must belong to the agent's project's
workspace; a project without a workspace cannot attach skills (clear 400, not
silence). Auto-match (tags ↔ capabilities) is rejected for v1 — implicit
attach is unauditable and the trust story of this EPIC is explicitness.

**Injection = token-override-else-append, inside `buildResolvedPrompt`.**
- If the agent's systemPrompt template contains `{{agent.skills}}` (the token
  fits the existing `word.word` resolver grammar — no regex change), the
  composed skills block substitutes there (placement control for power users).
- Otherwise the block is APPENDED to the resolved system prompt as a
  `## Skills` section whenever attached skills exist. Attaching is the only
  action required for the feature to work — the attach IS the flag (waiver
  recorded in the backlog).
- Because injection lives in `buildResolvedPrompt`, the DAEMON path gets it
  for free (payload v2 ships the server-resolved systemPrompt) — no payload
  change, no daemon change.

**Block format and caps.**

```
## Skills

### <skill title>
<skill body>
```

- Per-skill cap: 8,000 chars (body tail-truncated with `[skill truncated]`).
- Total block cap: 16,000 chars; skills are injected in attach order and the
  block is cut at the last whole skill that fits, ending with
  `[skills omitted: K of N shown — reduce attached skills]` when K < N.
- Caps are constants in the injection module; tests pin them.

**Load-time defense in depth.** `buildResolvedPrompt` loads skills by
`id IN skillIds AND workspaceId = project.workspaceId` — a stale attach to a
moved/deleted skill or a cross-workspace id silently drops out of the block
(and is recorded in evidence, below) rather than leaking across the boundary.

**Evidence.** The HTTP path's execution-evidence JSON (`memoryHits`,
`workingMemory`) gains `skillsInjected: string[]` (titles) so a reviewer can
see which playbooks shaped an output.

## Consequences

- The README claim becomes true for BOTH execution paths with one injection
  point; removing an attached skill verifiably changes the composed prompt
  (story e2e in G3-1-T2).
- Operators get deterministic, auditable prompt composition — no relevance
  ranking surprises. The cost: skills don't auto-apply; seeding content (the
  prompt-kit) requires explicit attach, which is the intended workflow.
- Workspace-less projects can't use skills until they adopt a workspace —
  consistent with daemon dispatch, which already requires one (G4-6 will
  revisit the workspace story; this ADR deliberately doesn't).
- `Skill.version`/`parentId` stay out of scope (de-claimed in G3-2; TD item).
- Cap constants are policy, not contract — changing them is a one-line edit +
  test update, no schema or payload impact.
