# Agent Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents distinguishable beyond emoji+name. Add a `personality` field (1-sentence voice/tone description), a shared `AgentBadge` component used everywhere agents are displayed, and flow the personality into every agent's system prompt via a `{{agent.personality}}` template slot.

**Architecture:** Three layers.
- **Data:** one new nullable `personality` column on `Agent` (max 280 chars), Zod contracts updated, Prisma client regenerated.
- **Prompt:** extend `resolvePrompt`'s `ResolveContext.agent` with `personality`, append `{{agent.personality}}` to the default agents' systemPrompts, and wire `agent.personality` through `dispatch.ts`.
- **UI:** single `AgentBadge` component (size variants: `compact` / `card` / `full`) replaces the ~8 ad-hoc `{emoji} {name}` spans scattered across `page.tsx`, `task-detail-drawer.tsx`, `chain-builder.tsx`, `workflow-editor.tsx`, `step-output-viewer.tsx`. Agent creation/edit modal gains a textarea for the field.

No API changes beyond the Zod contract extension (the existing `POST/PATCH /api/agents` endpoints accept the new field automatically once contracts are updated). Existing agents have `personality: null` — the badge gracefully skips rendering it in that case.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite dev / Postgres+pgvector prod), bun:test, Zod 4, React 19, Tailwind 4, shadcn/ui.

**Out of scope:** custom image avatars, AI-generated portraits, auto-derived colors from agent names, personality-based agent matchmaking. Emoji + color + personality text is enough distinction for Conductor's target scale.

---

## File Structure

**New files**
- `src/components/agent-badge.tsx` — unified agent display (emoji + color chip + name + optional role + optional personality, three size variants).
- `src/components/__tests__/agent-badge.test.tsx` — component tests (if a testing-library setup exists; otherwise skip — see Task 6).

**Modified files**
- `prisma/schema.prisma` — add `personality String?` to `Agent`.
- `src/lib/server/contracts.ts` — add `personality` to `createAgentSchema` + `updateAgentSchema`.
- `src/lib/server/resolve-prompt.ts` — extend `ResolveContext.agent` with `personality`.
- `src/lib/server/__tests__/resolve-prompt.test.ts` — cover the new slot.
- `src/lib/server/dispatch.ts` — pass `agent.personality` into `resolvePrompt`.
- `src/lib/server/default-agents.ts` — add `personality` field to the `DefaultAgent` interface, populate 11 agent definitions, add `{{agent.personality}}` to each `systemPrompt`.
- `src/components/agent-creation-modal.tsx` — local `Agent` interface + form state + textarea + payload.
- `src/app/page.tsx` — replace 3 inline agent renders with `<AgentBadge>`, update local `Agent` interface.
- `src/components/task-detail-drawer.tsx` — 2 replacements, update local `Agent` interface.
- `src/components/chain-builder.tsx` — 1 replacement, update local `Agent` interface.
- `src/components/workflow-editor.tsx` — 1 replacement, update local `Agent` interface.
- `src/components/step-output-viewer.tsx` — 1 replacement.

**Existing agents, not auto-migrated:** personality is null. They render without the personality line in the badge and the `{{agent.personality}}` slot resolves to `''` in their system prompt. Users edit to opt in.

---

## Task 1: Add `personality` to Prisma schema and Zod contracts

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add personality column to Agent**

In `prisma/schema.prisma`, locate the `Agent` model (around line 41-71). Add `personality` as a new field near the existing `description` field:

```prisma
model Agent {
  // ... existing fields ...
  description      String?
  personality      String?             // Max 280 chars enforced by Zod; 1-sentence voice/tone
  // ... existing fields ...
}
```

Place it directly after `description` for semantic proximity (both are human-written prose about the agent).

- [ ] **Step 2: Add personality to create and update Zod schemas**

In `src/lib/server/contracts.ts`, around line 42, locate `createAgentSchema`. Add:

```typescript
  personality: z.string().trim().max(280).optional(),
```

Place it directly after the `description: trimmedOptionalString,` line.

In `updateAgentSchema` (around line 60), add:

```typescript
  personality: z.string().trim().max(280).optional().nullable(),
```

Place it similarly after the `description: trimmedOptionalString,` line. Note the `.nullable()` — update schemas consistently allow `null` in this file to support field clearing.

- [ ] **Step 3: Push schema and regenerate client**

```bash
bun run db:push --accept-data-loss && bun run db:generate
```

Expected output: `Your database is now in sync with your Prisma schema` + `Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/lib/server/contracts.ts
git commit -m "feat(identity): add Agent.personality field (max 280 chars)"
```

---

## Task 2: Extend resolvePrompt with `{{agent.personality}}` slot

**Files:**
- Modify: `src/lib/server/resolve-prompt.ts`
- Modify: `src/lib/server/__tests__/resolve-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/__tests__/resolve-prompt.test.ts` inside the outer `describe('resolvePrompt', ...)` block (before the closing `})`):

```typescript
  test('replaces agent.personality', () => {
    const ctx = {
      ...baseCtx,
      agent: { ...baseCtx.agent, personality: 'Cautious senior engineer who double-checks edge cases' },
    }
    expect(resolvePrompt('Voice: {{agent.personality}}', ctx)).toBe(
      'Voice: Cautious senior engineer who double-checks edge cases'
    )
  })

  test('agent.personality renders empty when null', () => {
    const ctx = {
      ...baseCtx,
      agent: { ...baseCtx.agent, personality: null },
    }
    expect(resolvePrompt('a{{agent.personality}}b', ctx)).toBe('ab')
  })

  test('agent.personality renders empty when absent on ctx', () => {
    // baseCtx has no `personality` field on agent — placeholder resolves to ''
    expect(resolvePrompt('a{{agent.personality}}b', baseCtx)).toBe('ab')
  })
```

- [ ] **Step 2: Run tests to verify the first two fail**

Run: `bun test src/lib/server/__tests__/resolve-prompt.test.ts`
Expected: two new tests FAIL because `{{agent.personality}}` isn't registered. The "absent on ctx" test may pass already if unknown keys fall through — verify the actual failure mode.

- [ ] **Step 3: Extend the ResolveContext and variables map**

In `src/lib/server/resolve-prompt.ts`, update the type:

```typescript
type ResolveContext = {
  task: { title: string; description?: string | null }
  step: { mode: string; instructions?: string | null; previousOutput?: string | null }
  mode: { label: string; instructions?: string | null }
  agent: { name: string; role?: string | null; capabilities?: string | null; personality?: string | null }
  memory?: { recent?: string | null; relevant?: string | null }
}
```

Then in the `variables` record, add alongside the existing `agent.*` entries:

```typescript
    'agent.personality': ctx.agent.personality || '',
```

Place it right after `'agent.capabilities': ...`.

**Key semantics:** unlike `memory.recent` / `memory.relevant`, `agent.personality` is registered unconditionally (always maps to a string — empty when null). That matches how `agent.role` / `agent.capabilities` already behave; the memory fields are special because they're guarded by `if (ctx.memory)` to preserve backward-compat for callers not yet passing memory.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/server/__tests__/resolve-prompt.test.ts`
Expected: all tests PASS (24 existing + 3 new = 27).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/resolve-prompt.ts src/lib/server/__tests__/resolve-prompt.test.ts
git commit -m "feat(identity): resolvePrompt supports {{agent.personality}}"
```

---

## Task 3: Wire `personality` into dispatch

**Files:**
- Modify: `src/lib/server/dispatch.ts`

- [ ] **Step 1: Pass personality into the resolvePrompt agent context**

In `src/lib/server/dispatch.ts`, locate the `resolvePrompt` call around line 288. Current shape of the `agent:` argument:

```typescript
    agent: { name: agent.name, role: agent.role, capabilities },
```

Change to:

```typescript
    agent: { name: agent.name, role: agent.role, capabilities, personality: agent.personality },
```

The Prisma client already exposes `agent.personality` (string | null) after Task 1's schema regeneration. No new fetch needed — the existing `db.taskStep.findFirst(... include: { agent: { ... } } ...)` will automatically include all scalar columns unless a `select` narrows it. Verify by reading the surrounding code: if the agent is fetched via `select`, add `personality: true` there; if via `include`, nothing to change.

- [ ] **Step 2: Confirm the agent fetch shape**

Read `src/lib/server/dispatch.ts` around the `agent` fetch (search for `agent:` and `findFirst` / `findUnique`). Two cases:

- If the code uses `select: { ... }` on the agent, add `personality: true` to the select block.
- If it uses `include: { agent: true }` or no narrowing at all, no change needed — Prisma returns all scalar fields by default.

Do not speculatively run `db:generate` — it was already run in Task 1.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat(identity): pass agent.personality into dispatch prompt context"
```

---

## Task 4: Update default agents with personality values

**Files:**
- Modify: `src/lib/server/default-agents.ts`

- [ ] **Step 1: Add `personality` to the DefaultAgent interface**

In `src/lib/server/default-agents.ts`, locate the `DefaultAgent` interface around line 3. Current shape:

```typescript
interface DefaultAgent {
  name: string
  emoji: string
  color: string
  role: string
  description: string
  capabilities: string[]
  supportedModes: string[]
  modeInstructions: Record<string, string>
  systemPrompt: string
}
```

Add `personality: string` after `description`:

```typescript
interface DefaultAgent {
  name: string
  emoji: string
  color: string
  role: string
  description: string
  personality: string
  capabilities: string[]
  supportedModes: string[]
  modeInstructions: Record<string, string>
  systemPrompt: string
}
```

(Required, not optional — all 11 default agents get a personality.)

- [ ] **Step 2: Populate personality for all 11 default agents**

Add a `personality` field to each of the 11 agent definitions. Place the line directly after the `description` line for each. Use the values below verbatim:

| Agent | personality |
|---|---|
| Coder | `"Pragmatic implementer — matches existing patterns, ships small, asks before assuming."` |
| Architect | `"Systems thinker — maps boundaries before writing code; prefers explicit over clever."` |
| Sentinel | `"Adversarial reviewer — looks for what breaks under load, under attack, under wrong inputs."` |
| Inspector | `"Detail-oriented — reads every diff line; catches mistakes the author's eyes skipped."` |
| Tester | `"Coverage-minded — writes the test that would have caught the bug; values determinism."` |
| Scout | `"Explorer — probes unknowns first; reports back with findings before proposing changes."` |
| Scribe | `"Clarifying writer — turns scattered context into readable prose; leads with why."` |
| Red Team | `"Hostile imagination — enumerates misuse, abuse, and attack surface before defenders notice."` |
| FinOps | `"Cost-aware — quantifies spend impact; prefers measurable wins over vibes-based optimization."` |
| Data Engineer | `"Pipeline-minded — treats schema and provenance as first-class; distrusts silent data drift."` |
| Compliance | `"Evidence-driven — maps each control to an artifact; traceability over narrative."` |

Edit each `DefaultAgent` entry in the `DEFAULT_AGENTS` array to add this field. Example (Coder):

```typescript
  {
    name: 'Coder',
    emoji: '⚡',
    color: '#4ADE80',
    role: 'developer',
    description: 'Implementation specialist — writes production-grade code following project conventions',
    personality: 'Pragmatic implementer — matches existing patterns, ships small, asks before assuming.',
    capabilities: ['code-generation', 'refactoring', 'bug-fixing', 'testing', 'documentation'],
    // ... rest unchanged ...
  },
```

- [ ] **Step 3: Reference {{agent.personality}} in each systemPrompt**

For each of the 11 agents, locate the block near the top of the `systemPrompt` template that currently references `agent.role` / `agent.capabilities`. Coder's current version (around line 28):

```
You are {{agent.name}}, a production code implementation specialist.

Your role: {{agent.role}}
Your capabilities: {{agent.capabilities}}
```

Update to insert personality as a voice directive:

```
You are {{agent.name}}, a production code implementation specialist.

Your role: {{agent.role}}
Your voice: {{agent.personality}}
Your capabilities: {{agent.capabilities}}
```

Apply the same insertion pattern (add a `Your voice: {{agent.personality}}` line) to the 11 systemPrompts. Don't restructure the rest of the prompt — just add that one line in the identity block.

- [ ] **Step 4: Seed writes personality on new projects**

Search the file for where agents are inserted into the DB (`db.agent.create` or `db.agent.createMany`). Confirm `personality: defaultAgent.personality` is included in the insert payload. If the existing insert uses a spread or destructure that picks specific fields, add `personality` to that list. If it spreads the whole `DefaultAgent`, the field flows automatically.

Run: `grep -n "db.agent.create\|agent.createMany\|prisma.agent" src/lib/server/default-agents.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/default-agents.ts
git commit -m "feat(identity): populate personality for 11 default agents"
```

---

## Task 5: Create the AgentBadge component

**Files:**
- Create: `src/components/agent-badge.tsx`

- [ ] **Step 1: Define the component API**

Create `src/components/agent-badge.tsx`:

```tsx
import { cn } from '@/lib/utils'

export type AgentBadgeAgent = {
  name: string
  emoji: string
  color?: string | null
  role?: string | null
  personality?: string | null
}

type Size = 'compact' | 'card' | 'full'

type AgentBadgeProps = {
  agent: AgentBadgeAgent
  size?: Size
  className?: string
  /**
   * When true, truncate personality with a tooltip for full text.
   * Default: true when size is 'card', false otherwise.
   */
  truncatePersonality?: boolean
}

/**
 * Unified agent display.
 *
 * - `compact` — emoji only with a color dot; name in tooltip. Used in tight spaces like kanban card corners.
 * - `card` — emoji + name + role chip. Used in Select options, small cards.
 * - `full` — emoji + name + role chip + personality line underneath. Used in the agent list page, task-detail drawer.
 */
export function AgentBadge({ agent, size = 'card', className, truncatePersonality }: AgentBadgeProps) {
  const color = agent.color || '#3b82f6'
  const truncate = truncatePersonality ?? size === 'card'

  if (size === 'compact') {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-[11px]', className)}
        title={agent.name}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span>{agent.emoji}</span>
      </span>
    )
  }

  return (
    <span className={cn('inline-flex flex-col gap-0.5', className)}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="text-base leading-none">{agent.emoji}</span>
        <span className="font-medium text-sm leading-tight">{agent.name}</span>
        {agent.role ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
            style={{ backgroundColor: `${color}22`, color }}
          >
            {agent.role}
          </span>
        ) : null}
      </span>
      {size === 'full' && agent.personality ? (
        <span
          className={cn('text-xs text-muted-foreground italic', truncate && 'line-clamp-1')}
          title={truncate ? agent.personality : undefined}
        >
          {agent.personality}
        </span>
      ) : null}
    </span>
  )
}
```

**Design notes:**
- `compact` = tiny badge for kanban-card corner (current usage). Color dot + emoji; name in tooltip.
- `card` = default. Emoji + name + role chip. Fits Select options, chain step labels, activity rows.
- `full` = emoji + name + role chip + personality italic underneath. For primary edit surfaces.
- Color falls back to `#3b82f6` (the Prisma default) when null.
- Role is rendered as a colored chip using 13% opacity of the agent's own color for the background. No new dependency.
- Personality is `italic` + `text-muted-foreground` to read as a tagline, not a statement.

- [ ] **Step 2: Verify it compiles**

No test harness for React components currently exists in this repo (per the initial audit — there are only server-side `bun:test` files). We'll rely on the consumers in Task 6 to surface any type/import mistakes. Skip unit tests for the component.

Confirm imports resolve: `grep -n "export.*cn" src/lib/utils.ts` — should show the `cn` helper is exported (it is, from the existing tailwind-merge setup).

- [ ] **Step 3: Commit**

```bash
git add src/components/agent-badge.tsx
git commit -m "feat(identity): AgentBadge component with compact/card/full variants"
```

---

## Task 6: Replace inline agent renders across the UI

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/task-detail-drawer.tsx`
- Modify: `src/components/chain-builder.tsx`
- Modify: `src/components/workflow-editor.tsx`
- Modify: `src/components/step-output-viewer.tsx`

Every modification follows the same pattern: add the import, widen the local `Agent` interface to include `personality?: string | null`, swap the inline `{emoji} {name}` for `<AgentBadge agent={...} size="..." />`.

- [ ] **Step 1: page.tsx kanban card (size=compact)**

Locate line ~2022:

```tsx
                                    {task.agent && (
                                      <span className="text-[11px] shrink-0" title={task.agent.name}>
                                        {task.agent.emoji}
                                      </span>
                                    )}
```

Replace with:

```tsx
                                    {task.agent && (
                                      <AgentBadge agent={task.agent} size="compact" className="shrink-0" />
                                    )}
```

Similar replacement at line ~2129 in the same file (the second `task.agent.emoji` render — inspect and adapt if the surrounding classes differ).

- [ ] **Step 2: page.tsx task-edit Select options (size=card)**

Locate line ~2288:

```tsx
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.emoji} {agent.name}
                      </SelectItem>
```

Replace with:

```tsx
                      <SelectItem key={agent.id} value={agent.id}>
                        <AgentBadge agent={agent} size="card" />
                      </SelectItem>
```

- [ ] **Step 3: page.tsx imports + Agent interface**

At the top of `src/app/page.tsx`, add:

```typescript
import { AgentBadge } from '@/components/agent-badge'
```

In the local `Agent` interface (around line 79), add:

```typescript
  personality?: string | null
```

- [ ] **Step 4: task-detail-drawer.tsx (2 replacements)**

Locate line ~172:

```tsx
              <span>{task.agent.emoji}</span>
              <span>{task.agent.name}</span>
```

Replace with:

```tsx
              <AgentBadge agent={task.agent} size="full" />
```

Locate line ~267:

```tsx
                              {step.agent ? `${step.agent.emoji} ${step.agent.name}` : step.humanLabel || 'Human'}
```

Replace with:

```tsx
                              {step.agent ? <AgentBadge agent={step.agent} size="card" /> : (step.humanLabel || 'Human')}
```

Add the import at the top and update the local `Agent` interface (if present) with `personality?: string | null`.

- [ ] **Step 5: chain-builder.tsx (1 replacement)**

Locate line ~367:

```tsx
                            {agent.emoji} {agent.name}
```

Replace with:

```tsx
                            <AgentBadge agent={agent} size="card" />
```

Add the import and update the local `Agent` interface.

- [ ] **Step 6: workflow-editor.tsx (1 replacement)**

Locate line ~191:

```tsx
        {agent ? `${agent.emoji} ${agent.name}` : step.humanLabel || 'Human'}
```

Replace with:

```tsx
        {agent ? <AgentBadge agent={agent} size="card" /> : (step.humanLabel || 'Human')}
```

Add the import and update the local `Agent` interface.

- [ ] **Step 7: step-output-viewer.tsx (1 replacement)**

Locate line ~275:

```tsx
                          {step.agent ? `${step.agent.emoji} ${step.agent.name}` : step.humanLabel || 'Human'}
```

Replace with:

```tsx
                          {step.agent ? <AgentBadge agent={step.agent} size="card" /> : (step.humanLabel || 'Human')}
```

Add the import. If `step.agent` is typed inline (not via a reusable interface), widen it with `personality?: string | null`.

- [ ] **Step 8: Verify all call sites compile**

Because WSL-local `tsc` misses Next's route validator types, ask the user to run `bun run type-check` from Windows before the commit lands. (Report this in the DONE message.)

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx \
        src/components/task-detail-drawer.tsx \
        src/components/chain-builder.tsx \
        src/components/workflow-editor.tsx \
        src/components/step-output-viewer.tsx
git commit -m "feat(identity): replace inline agent renders with AgentBadge across the UI"
```

---

## Task 7: Wire personality input into the agent creation/edit modal

**Files:**
- Modify: `src/components/agent-creation-modal.tsx`

- [ ] **Step 1: Add personality to the local Agent interface**

In `src/components/agent-creation-modal.tsx`, locate the local `Agent` interface (around line 15). It already has `description?: string | null` (around line 20). Add right after it:

```typescript
  personality?: string | null
```

- [ ] **Step 2: Add personality to form state**

Around line 119, where `description` state is declared (`const [description, setDescription] = useState('')`), add:

```typescript
  const [personality, setPersonality] = useState('')
```

Around line 144, inside the `editingAgent` effect (where `setDescription(editingAgent.description || '')` runs), add:

```typescript
      setPersonality(editingAgent.personality || '')
```

- [ ] **Step 3: Add the textarea to the form**

Locate where the `description` textarea is rendered (around line 326 — `value={description}`). Directly after the description field block, insert a new field group. The exact markup depends on the surrounding form structure — read the surrounding 20 lines to match the pattern. Typical shape:

```tsx
              <div className="grid gap-2">
                <label htmlFor="personality" className="text-sm font-medium">
                  Personality
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    One sentence. How does this agent write and reason?
                  </span>
                </label>
                <Textarea
                  id="personality"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="e.g. Pragmatic implementer — matches existing patterns, ships small, asks before assuming."
                  maxLength={280}
                  rows={2}
                />
                <div className="text-xs text-muted-foreground text-right">
                  {personality.length}/280
                </div>
              </div>
```

- [ ] **Step 4: Add personality to the save payload**

Locate the `body`/`payload` object around line 218 where `description: description.trim() || undefined` is built. Add:

```typescript
      personality: personality.trim() || undefined,
```

(Same pattern as description — empty string collapses to `undefined` so nothing is sent when the user leaves it blank.)

- [ ] **Step 5: Commit**

```bash
git add src/components/agent-creation-modal.tsx
git commit -m "feat(identity): personality textarea in agent creation/edit modal"
```

---

## Self-Review Checklist (run before handoff)

- [ ] **Spec coverage:** Data layer (Task 1), prompt slot (Task 2), dispatch wiring (Task 3), default agents (Task 4), shared UI component (Task 5), UI replacements (Task 6), edit form (Task 7). All five elements of the scope brief covered.
- [ ] **No placeholders:** Every code snippet is literal. No `TODO`, no `similar to Task N`, no "add error handling."
- [ ] **Type consistency:**
  - `personality` is `String?` (SQL) / `string | null` (TS read) / `string | undefined` (TS form state) / `string.max(280).optional()` (Zod create) / `string.max(280).optional().nullable()` (Zod update).
  - `AgentBadgeAgent` has `personality?: string | null` — matches what Prisma returns and what the local `Agent` interfaces will have after Task 6.
  - `Size` type is `'compact' | 'card' | 'full'` — used consistently across Task 5 and Task 6.
- [ ] **Existing agents are not broken:** personality is nullable at every layer; badge's `full` variant renders nothing for the personality line when null; prompt slot resolves to empty string when null.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-agent-identity.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
