# Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Conductor agents persistent per-(agent, project) memory — a cheap "working memory" of recent task outputs injected into every system prompt, plus a long-term `AgentMemory` store that agents write to explicitly via a tool endpoint and read from via embedding-similarity search.

**Architecture:** Two tiers.
- **Tier 1 (working memory)** uses existing `Task` / `ActivityLog` data — no new tables. A helper fetches recent completed tasks for the agent and formats them into a block injected via a new `{{memory.recent}}` prompt variable.
- **Tier 2 (long-term memory)** adds an `AgentMemory` model with categories (`fact | decision | preference | pattern`). Agents write memories with `POST /api/agents/:id/memories`. Read path does embedding-similarity search (pgvector on Postgres, text-match fallback on SQLite) against the current task title/description and injects top-k into `{{memory.relevant}}`.

No automated LLM consolidation in this plan — agents are their own consolidators. We revisit that once real usage shows whether agents write useful memories on their own.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite dev / Postgres+pgvector prod), bun:test, Zod 4, OpenAI embeddings (already wired via `src/lib/server/embeddings.ts`)

**Out of scope:** nightly consolidation job, cross-project memory sharing, memory UI beyond a minimal list/delete panel.

**Existing pieces this plan leans on:**
- `src/lib/server/embeddings.ts` — OpenAI embedding call, returns `null` when no key
- `src/lib/server/resolve-prompt.ts` — `{{var.name}}` template engine, already used in dispatch
- `src/lib/db.ts` — exports `isPostgresDb` flag
- `Skill` model in `prisma/schema.prisma` — working precedent for "JSON on SQLite, cast to vector on Postgres" pattern

---

## File Structure

**New files**
- `src/lib/server/memory.ts` — service layer: `buildWorkingMemory`, `saveMemory`, `searchMemories`, `reinforceMemory`. Single focused file because read + write share context-building helpers.
- `src/lib/server/__tests__/memory.test.ts` — unit tests for memory service
- `src/app/api/agents/[id]/memories/route.ts` — `POST` (create) + `GET` (list) endpoints
- `src/components/agent-memory-panel.tsx` — minimal read-only memory list with delete

**Modified files**
- `prisma/schema.prisma` — add `AgentMemory` model, relation from `Agent`
- `src/lib/server/resolve-prompt.ts` — add `memory` context slot
- `src/lib/server/__tests__/resolve-prompt.test.ts` — tests for memory slot
- `src/lib/server/dispatch.ts` — call `buildWorkingMemory` before `resolvePrompt`
- `src/app/api/agent/next/route.ts` — include `memoryContext` in response
- `src/app/api/agent/tasks/[id]/route.ts` — include `memoryContext` in GET response
- `src/app/api/daemon/steps/next/route.ts` — resolved prompt already flows through dispatch, no change needed
- `src/lib/server/contracts.ts` — Zod schemas for memory create/list
- `src/lib/server/default-agents.ts` — add `{{memory.recent}}` and `{{memory.relevant}}` to default system prompt

---

## Task 1: Add buildWorkingMemory helper (Tier 1 read path)

**Files:**
- Create: `src/lib/server/memory.ts`
- Create: `src/lib/server/__tests__/memory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/__tests__/memory.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { db } from '@/lib/db'
import { buildWorkingMemory } from '@/lib/server/memory'

describe('buildWorkingMemory', () => {
  let projectId: string
  let agentId: string

  beforeEach(async () => {
    const project = await db.project.create({ data: { name: 'mem-test' } })
    projectId = project.id
    const agent = await db.agent.create({
      data: { name: 'memtest-agent', projectId },
    })
    agentId = agent.id
  })

  afterEach(async () => {
    await db.project.delete({ where: { id: projectId } }).catch(() => {})
  })

  test('returns empty string when agent has no completed tasks', async () => {
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).toBe('')
  })

  test('formats recent completed tasks with title and output', async () => {
    await db.task.create({
      data: {
        title: 'Fix login bug',
        status: 'DONE',
        output: 'Root cause: timeout in auth.ts. Fixed by bumping to 60s.',
        completedAt: new Date(),
        projectId,
        agentId,
      },
    })

    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).toContain('Fix login bug')
    expect(result).toContain('Root cause: timeout')
  })

  test('limits to most recent N tasks (default 5)', async () => {
    for (let i = 0; i < 8; i++) {
      await db.task.create({
        data: {
          title: `Task ${i}`,
          status: 'DONE',
          output: `output-${i}`,
          completedAt: new Date(Date.now() + i * 1000),
          projectId,
          agentId,
        },
      })
    }
    const result = await buildWorkingMemory({ agentId, projectId, maxRecent: 5 })
    expect(result).toContain('Task 7')
    expect(result).toContain('Task 3')
    expect(result).not.toContain('Task 2')
  })

  test('truncates each task output to maxCharsPerEntry', async () => {
    await db.task.create({
      data: {
        title: 'Big task',
        status: 'DONE',
        output: 'x'.repeat(5000),
        completedAt: new Date(),
        projectId,
        agentId,
      },
    })
    const result = await buildWorkingMemory({ agentId, projectId, maxCharsPerEntry: 200 })
    expect(result.length).toBeLessThan(600)
    expect(result).toContain('Big task')
  })

  test('only includes DONE tasks, not IN_PROGRESS or BACKLOG', async () => {
    await db.task.create({
      data: { title: 'In-progress task', status: 'IN_PROGRESS', projectId, agentId },
    })
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).not.toContain('In-progress task')
  })

  test('only includes tasks for the given (agent, project) pair', async () => {
    const otherAgent = await db.agent.create({ data: { name: 'other', projectId } })
    await db.task.create({
      data: {
        title: "Other agent's task",
        status: 'DONE',
        output: 'should not appear',
        completedAt: new Date(),
        projectId,
        agentId: otherAgent.id,
      },
    })
    const result = await buildWorkingMemory({ agentId, projectId })
    expect(result).not.toContain("Other agent's task")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/__tests__/memory.test.ts`
Expected: FAIL with `Cannot find module '@/lib/server/memory'`

- [ ] **Step 3: Implement buildWorkingMemory**

Create `src/lib/server/memory.ts`:

```typescript
import { db } from '@/lib/db'

type WorkingMemoryOpts = {
  agentId: string
  projectId: string
  maxRecent?: number
  maxCharsPerEntry?: number
}

/**
 * Tier 1: recent task outputs for this (agent, project).
 * Returns a formatted block to inject into the system prompt, or '' when empty.
 */
export async function buildWorkingMemory(opts: WorkingMemoryOpts): Promise<string> {
  const maxRecent = opts.maxRecent ?? 5
  const maxCharsPerEntry = opts.maxCharsPerEntry ?? 400

  const tasks = await db.task.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      status: 'DONE',
    },
    orderBy: { completedAt: 'desc' },
    take: maxRecent,
    select: { title: true, output: true, completedAt: true },
  })

  if (tasks.length === 0) return ''

  const entries = tasks.map((t) => {
    const output = (t.output || '').slice(0, maxCharsPerEntry).trim()
    return `- ${t.title}${output ? `\n  ${output.replace(/\n/g, '\n  ')}` : ''}`
  })

  return `Recent work you've completed on this project:\n${entries.join('\n')}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/server/__tests__/memory.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/memory.ts src/lib/server/__tests__/memory.test.ts
git commit -m "feat(memory): buildWorkingMemory reads recent completed tasks for an agent"
```

---

## Task 2: Extend resolvePrompt with memory slot

**Files:**
- Modify: `src/lib/server/resolve-prompt.ts`
- Modify: `src/lib/server/__tests__/resolve-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/__tests__/resolve-prompt.test.ts` (before the closing `})`):

```typescript
  test('replaces memory.recent', () => {
    const ctx = {
      ...baseCtx,
      memory: { recent: '- Prior task A\n- Prior task B', relevant: '' },
    }
    expect(resolvePrompt('Memory: {{memory.recent}}', ctx)).toBe(
      'Memory: - Prior task A\n- Prior task B'
    )
  })

  test('replaces memory.relevant', () => {
    const ctx = {
      ...baseCtx,
      memory: { recent: '', relevant: '- Fact: prod DB is at 10.0.0.5' },
    }
    expect(resolvePrompt('{{memory.relevant}}', ctx)).toBe('- Fact: prod DB is at 10.0.0.5')
  })

  test('missing memory context leaves placeholder', () => {
    // baseCtx has no memory key — placeholder should stay unresolved
    expect(resolvePrompt('{{memory.recent}}', baseCtx)).toBe('{{memory.recent}}')
  })

  test('both memory slots empty render as empty strings when present', () => {
    const ctx = { ...baseCtx, memory: { recent: '', relevant: '' } }
    expect(resolvePrompt('a{{memory.recent}}b{{memory.relevant}}c', ctx)).toBe('abc')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/__tests__/resolve-prompt.test.ts`
Expected: FAIL — `{{memory.recent}}` returns unchanged

- [ ] **Step 3: Extend ResolveContext and resolvePrompt**

Replace the contents of `src/lib/server/resolve-prompt.ts`:

```typescript
type ResolveContext = {
  task: { title: string; description?: string | null }
  step: { mode: string; instructions?: string | null; previousOutput?: string | null }
  mode: { label: string; instructions?: string | null }
  agent: { name: string; role?: string | null; capabilities?: string | null }
  memory?: { recent?: string | null; relevant?: string | null }
}

export function resolvePrompt(template: string, ctx: ResolveContext): string {
  const variables: Record<string, string> = {
    'task.title': ctx.task.title,
    'task.description': ctx.task.description || '',
    'step.mode': ctx.step.mode,
    'step.instructions': ctx.step.instructions || '',
    'step.previousOutput': ctx.step.previousOutput || '',
    'mode.label': ctx.mode.label,
    'mode.instructions': ctx.mode.instructions || '',
    'agent.name': ctx.agent.name,
    'agent.role': ctx.agent.role || '',
    'agent.capabilities': ctx.agent.capabilities || '',
  }

  if (ctx.memory) {
    variables['memory.recent'] = ctx.memory.recent || ''
    variables['memory.relevant'] = ctx.memory.relevant || ''
  }

  return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match
  })
}
```

Note the deliberate asymmetry: when `ctx.memory` is absent the placeholder stays unresolved (so existing callers that don't yet pass memory aren't silently stripping tokens); when `ctx.memory` is present but fields are empty, they render as `''`. The test covers both cases.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/server/__tests__/resolve-prompt.test.ts`
Expected: all tests PASS (including 4 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/resolve-prompt.ts src/lib/server/__tests__/resolve-prompt.test.ts
git commit -m "feat(memory): resolvePrompt supports {{memory.recent}} and {{memory.relevant}}"
```

---

## Task 3: Wire working memory into dispatch (daemon/HTTP step execution)

**Files:**
- Modify: `src/lib/server/dispatch.ts`

- [ ] **Step 1: Import buildWorkingMemory**

At the top of `src/lib/server/dispatch.ts`, add to the existing imports block:

```typescript
import { buildWorkingMemory } from '@/lib/server/memory'
```

- [ ] **Step 2: Call buildWorkingMemory before resolvePrompt**

In `src/lib/server/dispatch.ts`, locate the block around line 264-273 that reads:

```typescript
  const capabilities = agent.capabilities
    ? safeJsonParse<string[]>(agent.capabilities, []).join(', ')
    : ''

  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
  })
```

Replace it with:

```typescript
  const capabilities = agent.capabilities
    ? safeJsonParse<string[]>(agent.capabilities, []).join(', ')
    : ''

  const workingMemory = await buildWorkingMemory({
    agentId: agent.id,
    projectId: step.task.projectId,
  })

  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
    memory: { recent: workingMemory, relevant: '' },
  })
```

- [ ] **Step 3: Verify type-check passes**

Because the WSL-local `tsc` misses `.next/types/validator.ts` in this repo, ask the user to run the Windows type-check:

> "Can you run `bun run type-check` from Windows and paste the result? WSL tsc doesn't see the Next validator types."

Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat(memory): inject working memory into dispatch systemPrompt"
```

---

## Task 4: Return memoryContext to HTTP-polling agents

HTTP agents don't flow through `dispatch.ts` — they poll `/api/agent/next` and read `/api/agent/tasks/[id]`. They need memory returned in the JSON response so their CLI wrapper can fold it into its own prompt.

**Files:**
- Modify: `src/app/api/agent/next/route.ts`
- Modify: `src/app/api/agent/tasks/[id]/route.ts`

- [ ] **Step 1: Update /api/agent/next to include memoryContext**

In `src/app/api/agent/next/route.ts`, add the import at the top:

```typescript
import { buildWorkingMemory } from '@/lib/server/memory'
```

Then before each of the three `return NextResponse.json({ ..., task: <X>, ... })` calls that currently return a real task (the `inProgressTask`, `assignedBacklogTask`, and `unassignedTask` branches), compute memory once at the top of the handler right after `resolveAgentByApiKey`:

Locate:

```typescript
    // Update agent last seen (debounced — at most one DB write per 30s per agent)
    const didWrite = await updateAgentHeartbeat(agent.id)
```

Insert immediately above it:

```typescript
  const memoryContext = await buildWorkingMemory({
    agentId: agent.id,
    projectId: agent.projectId,
  })
```

Then update each of the three response objects that return a task. For example:

```typescript
    if (inProgressTask) {
      return NextResponse.json({
        message: 'You have a task in progress',
        task: inProgressTask,
        memoryContext,
        suggestion: 'Complete or update the in-progress task before claiming new ones',
      })
    }
```

Apply the same `memoryContext,` addition to the `assignedBacklogTask` and `unassignedTask` branches. The "no tasks available" branch does **not** need it (no task = no context).

- [ ] **Step 2: Update /api/agent/tasks/[id] GET to include memoryContext**

In `src/app/api/agent/tasks/[id]/route.ts`, add the import:

```typescript
import { buildWorkingMemory } from '@/lib/server/memory'
```

Locate the `GET` handler's return statement:

```typescript
    await updateAgentHeartbeat(agent.id)
    return NextResponse.json(task)
```

Replace with:

```typescript
    await updateAgentHeartbeat(agent.id)
    const memoryContext = await buildWorkingMemory({
      agentId: agent.id,
      projectId: agent.projectId,
    })
    return NextResponse.json({ ...task, memoryContext })
```

- [ ] **Step 3: Smoke test manually**

Start dev server:

```bash
bun run dev
```

From another shell, create a project + agent + a completed task (or use Load Demo Data), grab the agent key from Settings → API Keys, then:

```bash
curl -s http://localhost:3000/api/agent/next -H "Authorization: Bearer $AGENT_KEY" | jq .memoryContext
```

Expected: string starting with `"Recent work you've completed on this project:..."` when the agent has DONE tasks; `""` otherwise.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/next/route.ts src/app/api/agent/tasks/\[id\]/route.ts
git commit -m "feat(memory): return memoryContext to HTTP-polling agents"
```

---

## Task 5: Add AgentMemory model and Zod contracts (Tier 2 schema)

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add AgentMemory model**

In `prisma/schema.prisma`, add after the `Skill` model (around line 340):

```prisma
model AgentMemory {
  id            String   @id @default(cuid())
  agentId       String
  agent         Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  projectId     String
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  category      String   // fact | decision | preference | pattern
  content       String
  sourceTaskId  String?  // task that produced this memory, if any
  confidence    Float    @default(0.8)
  reinforcement Int      @default(1)
  lastAccessed  DateTime?
  embedding     String?  // JSON float array on SQLite; cast to vector(1536) via raw SQL on Postgres
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([agentId, projectId])
  @@index([projectId])
}
```

- [ ] **Step 2: Add reverse relations on Agent and Project**

In `prisma/schema.prisma`, inside `model Agent { ... }` add:

```prisma
  memories         AgentMemory[]
```

Inside `model Project { ... }` add:

```prisma
  memories           AgentMemory[]
```

- [ ] **Step 3: Add Zod schemas**

In `src/lib/server/contracts.ts`, append:

```typescript
export const memoryCategorySchema = z.enum(['fact', 'decision', 'preference', 'pattern'])

export const createMemorySchema = z.object({
  category: memoryCategorySchema,
  content: z.string().min(1).max(2000),
  sourceTaskId: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

export const listMemoriesSchema = z.object({
  projectId: z.string().optional(),
  category: memoryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
```

- [ ] **Step 4: Push schema and regenerate client**

```bash
bun run db:push --accept-data-loss && bun run db:generate
```

Expected: Prisma reports `AgentMemory` table created, generated client updates.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/server/contracts.ts src/generated/
git commit -m "feat(memory): add AgentMemory model and Zod contracts"
```

---

## Task 6: Implement saveMemory, searchMemories, reinforceMemory

**Files:**
- Modify: `src/lib/server/memory.ts`
- Modify: `src/lib/server/__tests__/memory.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/lib/server/__tests__/memory.test.ts` (before the closing `})` of the outer `describe`):

```typescript
  describe('saveMemory + searchMemories (text-fallback path)', () => {
    test('saveMemory persists with defaults', async () => {
      const { saveMemory } = await import('@/lib/server/memory')
      const m = await saveMemory({
        agentId,
        projectId,
        category: 'fact',
        content: 'Prod DB is at 10.0.0.5',
      })
      expect(m.id).toBeTruthy()
      expect(m.category).toBe('fact')
      expect(m.reinforcement).toBe(1)
    })

    test('searchMemories text-matches content (SQLite path)', async () => {
      const { saveMemory, searchMemories } = await import('@/lib/server/memory')
      await saveMemory({
        agentId, projectId, category: 'fact',
        content: 'Prod DB is at 10.0.0.5',
      })
      await saveMemory({
        agentId, projectId, category: 'preference',
        content: 'Prefer TypeScript strict mode',
      })

      const hits = await searchMemories({
        agentId, projectId, query: 'prod database', limit: 5,
      })
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].content).toContain('Prod DB')
    })

    test('searchMemories scopes by (agent, project)', async () => {
      const { saveMemory, searchMemories } = await import('@/lib/server/memory')
      const otherAgent = await db.agent.create({ data: { name: 'other', projectId } })
      await saveMemory({
        agentId: otherAgent.id, projectId, category: 'fact',
        content: 'should not leak across agents',
      })

      const hits = await searchMemories({
        agentId, projectId, query: 'leak', limit: 5,
      })
      expect(hits).toHaveLength(0)
    })

    test('reinforceMemory bumps reinforcement and lastAccessed', async () => {
      const { saveMemory, reinforceMemory } = await import('@/lib/server/memory')
      const m = await saveMemory({
        agentId, projectId, category: 'fact', content: 'x',
      })
      const before = m.reinforcement
      const updated = await reinforceMemory(m.id)
      expect(updated.reinforcement).toBe(before + 1)
      expect(updated.lastAccessed).not.toBeNull()
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/lib/server/__tests__/memory.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 3: Implement save / search / reinforce**

Replace the contents of `src/lib/server/memory.ts` with:

```typescript
import { db, isPostgresDb } from '@/lib/db'
import { generateEmbedding } from '@/lib/server/embeddings'

// ─── Tier 1 ──────────────────────────────────────────────────────────────

type WorkingMemoryOpts = {
  agentId: string
  projectId: string
  maxRecent?: number
  maxCharsPerEntry?: number
}

export async function buildWorkingMemory(opts: WorkingMemoryOpts): Promise<string> {
  const maxRecent = opts.maxRecent ?? 5
  const maxCharsPerEntry = opts.maxCharsPerEntry ?? 400

  const tasks = await db.task.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      status: 'DONE',
    },
    orderBy: { completedAt: 'desc' },
    take: maxRecent,
    select: { title: true, output: true, completedAt: true },
  })

  if (tasks.length === 0) return ''

  const entries = tasks.map((t) => {
    const output = (t.output || '').slice(0, maxCharsPerEntry).trim()
    return `- ${t.title}${output ? `\n  ${output.replace(/\n/g, '\n  ')}` : ''}`
  })

  return `Recent work you've completed on this project:\n${entries.join('\n')}`
}

// ─── Tier 2: persistent memories ─────────────────────────────────────────

export type MemoryCategory = 'fact' | 'decision' | 'preference' | 'pattern'

type SaveMemoryInput = {
  agentId: string
  projectId: string
  category: MemoryCategory
  content: string
  sourceTaskId?: string
  confidence?: number
}

export async function saveMemory(input: SaveMemoryInput) {
  const embeddingVec = await generateEmbedding(input.content)

  return db.agentMemory.create({
    data: {
      agentId: input.agentId,
      projectId: input.projectId,
      category: input.category,
      content: input.content,
      sourceTaskId: input.sourceTaskId,
      confidence: input.confidence ?? 0.8,
      embedding: embeddingVec ? JSON.stringify(embeddingVec) : null,
    },
  })
}

type SearchMemoriesOpts = {
  agentId: string
  projectId: string
  query: string
  limit?: number
}

type MemoryHit = {
  id: string
  category: string
  content: string
  confidence: number
  reinforcement: number
  score: number | null
}

export async function searchMemories(opts: SearchMemoriesOpts): Promise<MemoryHit[]> {
  const limit = opts.limit ?? 5

  if (isPostgresDb) {
    const vec = await generateEmbedding(opts.query)
    if (vec) {
      const vectorStr = `[${vec.join(',')}]`
      const rows = await db.$queryRawUnsafe<Array<{
        id: string; category: string; content: string
        confidence: number; reinforcement: number; distance: number
      }>>(
        `SELECT id, category, content, confidence, reinforcement,
                embedding::vector <=> $1::vector AS distance
         FROM "AgentMemory"
         WHERE embedding IS NOT NULL
           AND "agentId" = $2
           AND "projectId" = $3
         ORDER BY distance ASC
         LIMIT $4`,
        vectorStr, opts.agentId, opts.projectId, limit,
      )
      return rows.map((r) => ({
        id: r.id,
        category: r.category,
        content: r.content,
        confidence: r.confidence,
        reinforcement: r.reinforcement,
        score: 1 - r.distance,
      }))
    }
  }

  // SQLite fallback — or Postgres when no embedding key or unembedded rows
  const rows = await db.agentMemory.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      content: { contains: opts.query },
    },
    orderBy: [{ reinforcement: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true, category: true, content: true,
      confidence: true, reinforcement: true,
    },
  })
  return rows.map((r) => ({ ...r, score: null }))
}

export async function reinforceMemory(id: string) {
  return db.agentMemory.update({
    where: { id },
    data: {
      reinforcement: { increment: 1 },
      lastAccessed: new Date(),
    },
  })
}

/**
 * Tier 2: format top-k relevant memories into a prompt block.
 * Called from dispatch alongside buildWorkingMemory.
 */
export async function buildRelevantMemory(opts: {
  agentId: string
  projectId: string
  query: string
  limit?: number
}): Promise<string> {
  const hits = await searchMemories(opts)
  if (hits.length === 0) return ''

  // Best-effort reinforcement — don't block on failures
  await Promise.all(hits.map((h) => reinforceMemory(h.id).catch(() => null)))

  const lines = hits.map((h) => `- [${h.category}] ${h.content}`)
  return `Persistent memory (things you've learned on this project):\n${lines.join('\n')}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/lib/server/__tests__/memory.test.ts`
Expected: all tests PASS. The Postgres-specific pgvector path is not covered by these tests (SQLite in dev) — that's fine; text-fallback is what SQLite hits.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/memory.ts src/lib/server/__tests__/memory.test.ts
git commit -m "feat(memory): saveMemory, searchMemories, reinforceMemory + relevant-memory builder"
```

---

## Task 7: Expose memory write + read API for agents

**Files:**
- Create: `src/app/api/agents/[id]/memories/route.ts`

- [ ] **Step 1: Create the route file**

Create `src/app/api/agents/[id]/memories/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { createMemorySchema, listMemoriesSchema } from '@/lib/server/contracts'
import { saveMemory } from '@/lib/server/memory'

/**
 * Agents list their own memories. Scoped by API key — agent can only see its own.
 * Admin UI reads via this same endpoint with an admin session (see Task 9).
 */
export const GET = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const apiKey = extractAgentApiKey(request)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden('Cannot read another agent\'s memories')

    const { searchParams } = new URL(request.url)
    const parsed = listMemoriesSchema.safeParse({
      projectId: searchParams.get('projectId') || undefined,
      category: searchParams.get('category') || undefined,
      limit: searchParams.get('limit') || undefined,
    })
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid query')
    }

    const { projectId, category, limit } = parsed.data

    const memories = await db.agentMemory.findMany({
      where: {
        agentId: agent.id,
        ...(projectId ? { projectId } : { projectId: agent.projectId }),
        ...(category ? { category } : {}),
      },
      orderBy: [{ reinforcement: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true, category: true, content: true, confidence: true,
        reinforcement: true, sourceTaskId: true, lastAccessed: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ data: memories, total: memories.length })
  },
)

/**
 * Agents write a memory. Category + content required.
 * Memory is scoped to (agent, agent.projectId) — no cross-project writes.
 */
export const POST = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const body = await request.json()
    const apiKey = extractAgentApiKey(request, body)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden('Cannot write another agent\'s memories')

    const parsed = createMemorySchema.safeParse(body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid memory payload')
    }

    if (parsed.data.sourceTaskId) {
      const task = await db.task.findUnique({
        where: { id: parsed.data.sourceTaskId },
        select: { projectId: true },
      })
      if (!task) throw notFound('sourceTaskId not found')
      if (task.projectId !== agent.projectId) {
        throw forbidden('sourceTaskId belongs to a different project')
      }
    }

    const memory = await saveMemory({
      agentId: agent.id,
      projectId: agent.projectId,
      category: parsed.data.category,
      content: parsed.data.content,
      sourceTaskId: parsed.data.sourceTaskId,
      confidence: parsed.data.confidence,
    })

    return NextResponse.json(memory)
  },
)

/**
 * DELETE /api/agents/:id/memories?memoryId=xxx
 * Admin-only (via session) OR the owning agent.
 */
export const DELETE = withErrorHandling(
  'api/agents/[id]/memories',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const apiKey = extractAgentApiKey(request)
    if (!apiKey) throw unauthorized('Missing agent API key')

    const agent = await resolveAgentByApiKey(apiKey)
    if (!agent) throw unauthorized('Invalid API key')

    const { id } = await params
    if (agent.id !== id) throw forbidden('Cannot delete another agent\'s memories')

    const { searchParams } = new URL(request.url)
    const memoryId = searchParams.get('memoryId')
    if (!memoryId) throw badRequest('Missing memoryId')

    const memory = await db.agentMemory.findUnique({ where: { id: memoryId } })
    if (!memory) throw notFound('Memory not found')
    if (memory.agentId !== agent.id) throw forbidden('Not your memory')

    await db.agentMemory.delete({ where: { id: memoryId } })
    return NextResponse.json({ ok: true })
  },
)
```

- [ ] **Step 2: Smoke-test the endpoints**

With dev server running and an agent key in hand:

```bash
# Write a memory
curl -s -X POST http://localhost:3000/api/agents/$AGENT_ID/memories \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"category":"fact","content":"Prod DB is at 10.0.0.5"}'

# List memories
curl -s http://localhost:3000/api/agents/$AGENT_ID/memories \
  -H "Authorization: Bearer $AGENT_KEY" | jq .

# Forbidden cross-agent read (should 403)
curl -si http://localhost:3000/api/agents/OTHER_AGENT_ID/memories \
  -H "Authorization: Bearer $AGENT_KEY" | head -1
```

Expected: POST returns the memory record; GET lists it; cross-agent GET returns `403`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agents/\[id\]/memories/route.ts
git commit -m "feat(memory): POST/GET/DELETE /api/agents/:id/memories"
```

---

## Task 8: Wire relevant-memory retrieval into dispatch and HTTP polling

**Files:**
- Modify: `src/lib/server/dispatch.ts`
- Modify: `src/app/api/agent/next/route.ts`
- Modify: `src/app/api/agent/tasks/[id]/route.ts`

- [ ] **Step 1: Use buildRelevantMemory in dispatch**

In `src/lib/server/dispatch.ts`, update the import from `@/lib/server/memory`:

```typescript
import { buildWorkingMemory, buildRelevantMemory } from '@/lib/server/memory'
```

Replace the block added in Task 3:

```typescript
  const workingMemory = await buildWorkingMemory({
    agentId: agent.id,
    projectId: step.task.projectId,
  })

  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
    memory: { recent: workingMemory, relevant: '' },
  })
```

with:

```typescript
  const memoryQuery = [step.task.title, step.task.description, step.instructions]
    .filter(Boolean)
    .join('\n')

  const [workingMemory, relevantMemory] = await Promise.all([
    buildWorkingMemory({
      agentId: agent.id,
      projectId: step.task.projectId,
    }),
    buildRelevantMemory({
      agentId: agent.id,
      projectId: step.task.projectId,
      query: memoryQuery,
      limit: 5,
    }),
  ])

  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
    memory: { recent: workingMemory, relevant: relevantMemory },
  })
```

- [ ] **Step 2: Include relevantMemory in HTTP poll responses**

In `src/app/api/agent/next/route.ts`, update the import:

```typescript
import { buildWorkingMemory, buildRelevantMemory } from '@/lib/server/memory'
```

Because each of the three branches has a different task, compute relevant memory per-branch. Replace the top-of-handler block:

```typescript
  const memoryContext = await buildWorkingMemory({
    agentId: agent.id,
    projectId: agent.projectId,
  })
```

with a helper below and call it inline for each branch. Define at the top of the handler function (just after agent resolution) a local helper:

```typescript
  const recentMemory = await buildWorkingMemory({
    agentId: agent.id,
    projectId: agent.projectId,
  })

  const memoryFor = async (task: { title: string; description?: string | null } | null) => {
    const relevant = task
      ? await buildRelevantMemory({
          agentId: agent.id,
          projectId: agent.projectId,
          query: [task.title, task.description].filter(Boolean).join('\n'),
          limit: 5,
        })
      : ''
    return { recent: recentMemory, relevant }
  }
```

Then in each of the three task-returning branches, replace `memoryContext,` with:

```typescript
        memoryContext: await memoryFor(inProgressTask),   // or assignedBacklogTask / unassignedTask
```

- [ ] **Step 3: Same update for /api/agent/tasks/[id] GET**

In `src/app/api/agent/tasks/[id]/route.ts`, update the import:

```typescript
import { buildWorkingMemory, buildRelevantMemory } from '@/lib/server/memory'
```

Replace the existing GET return block (the one added in Task 4):

```typescript
    const memoryContext = await buildWorkingMemory({
      agentId: agent.id,
      projectId: agent.projectId,
    })
    return NextResponse.json({ ...task, memoryContext })
```

with:

```typescript
    const [recent, relevant] = await Promise.all([
      buildWorkingMemory({ agentId: agent.id, projectId: agent.projectId }),
      buildRelevantMemory({
        agentId: agent.id,
        projectId: agent.projectId,
        query: [task.title, task.description].filter(Boolean).join('\n'),
        limit: 5,
      }),
    ])
    return NextResponse.json({ ...task, memoryContext: { recent, relevant } })
```

Note: this changes `memoryContext` from `string` to `{ recent, relevant }`. Do the same for the three `/api/agent/next` branches — change `memoryContext` there from string to object now that both slots exist. (Ensure consistency across all four responses.)

- [ ] **Step 4: Smoke-test**

With a memory saved from Task 7 whose content matches an upcoming task's title:

```bash
curl -s http://localhost:3000/api/agent/next -H "Authorization: Bearer $AGENT_KEY" | jq .memoryContext
```

Expected: object with `recent` and `relevant` string fields; `relevant` non-empty when a memory matches the task query.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dispatch.ts src/app/api/agent/next/route.ts src/app/api/agent/tasks/\[id\]/route.ts
git commit -m "feat(memory): wire relevant-memory retrieval into dispatch and HTTP polling"
```

---

## Task 9: Update default agent system prompt to use memory slots

**Files:**
- Modify: `src/lib/server/default-agents.ts`

- [ ] **Step 1: Inspect current defaults**

Run: `cat src/lib/server/default-agents.ts | head -80`

Identify the default `systemPrompt` templates. New agents created via the UI inherit from here — the memory slots won't do anything unless the template references `{{memory.recent}}` and `{{memory.relevant}}`.

- [ ] **Step 2: Append memory block to default systemPrompt**

For each default agent's `systemPrompt` field in `src/lib/server/default-agents.ts`, append the following block to the end of the prompt string (before any closing backtick):

```
{{memory.recent}}

{{memory.relevant}}
```

If a default agent has no `systemPrompt`, leave it alone — resolvePrompt runs on `agent.systemPrompt || ''` and the memory work happens at runtime, not at agent-creation time.

The key insight: already-existing agents in users' databases won't auto-update. That's fine for v1 — they can edit their prompt to add the slots, or we add a migration later. Call this out in the commit message.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/default-agents.ts
git commit -m "feat(memory): default agent prompts include memory slots

Existing agents aren't auto-migrated — they continue to work without memory
injected. Edit the agent's system prompt to add {{memory.recent}} /
{{memory.relevant}} to opt in."
```

---

## Task 10: Minimal admin UI for viewing/deleting an agent's memories

**Files:**
- Create: `src/components/agent-memory-panel.tsx`
- Modify: (wherever the agent settings modal lives — typically `src/components/agent-creation-modal.tsx` or a sibling settings drawer)

- [ ] **Step 1: Find the agent settings surface**

Run: `grep -l "agent-creation-modal\|AgentSettings\|AgentPanel" src/components/ src/app/ -r 2>/dev/null | head -10`

Identify the component where an existing agent's details are edited. If there's a Tabs/drawer structure, the memory panel becomes a new tab. If not, add it below the existing fields.

- [ ] **Step 2: Create the memory panel component**

Create `src/components/agent-memory-panel.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type Memory = {
  id: string
  category: string
  content: string
  confidence: number
  reinforcement: number
  createdAt: string
  lastAccessed: string | null
}

export function AgentMemoryPanel({
  agentId,
  agentApiKey,
}: {
  agentId: string
  agentApiKey: string | null
}) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!agentApiKey) return
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/memories?limit=100`, {
        headers: { Authorization: `Bearer ${agentApiKey}` },
      })
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setMemories(json.data)
    } catch (err) {
      toast.error(`Load failed: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [agentId, agentApiKey])

  const remove = async (memoryId: string) => {
    if (!agentApiKey) return
    if (!confirm('Delete this memory?')) return
    const res = await fetch(`/api/agents/${agentId}/memories?memoryId=${memoryId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${agentApiKey}` },
    })
    if (!res.ok) {
      toast.error('Delete failed')
      return
    }
    setMemories((prev) => prev.filter((m) => m.id !== memoryId))
  }

  if (!agentApiKey) {
    return <div className="text-sm text-muted-foreground">Rotate the agent API key to view memories.</div>
  }
  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (memories.length === 0) {
    return <div className="text-sm text-muted-foreground">No memories yet. Agents write them via POST /api/agents/:id/memories.</div>
  }

  return (
    <div className="space-y-2">
      {memories.map((m) => (
        <div key={m.id} className="flex items-start gap-2 rounded border p-2 text-sm">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">{m.category}</span>
          <div className="flex-1">
            <div>{m.content}</div>
            <div className="text-xs text-muted-foreground mt-1">
              reinforced {m.reinforcement}x · {new Date(m.createdAt).toLocaleDateString()}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => remove(m.id)}>×</Button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Mount the panel in the agent settings surface**

In whatever component you identified in Step 1, import and render `<AgentMemoryPanel agentId={agent.id} agentApiKey={agent.apiKey || null} />` beneath the existing fields (or in a new "Memory" tab if tabs exist).

The exact insertion is codebase-dependent — keep the change minimal: one import line and one JSX line. Don't restructure surrounding code.

- [ ] **Step 4: Smoke-test in browser**

Start the dev server (`bun run dev`), open the agent settings for an agent that has memories (use Task 7's curl to seed one), confirm the panel lists the memory and delete works.

- [ ] **Step 5: Commit**

```bash
git add src/components/agent-memory-panel.tsx src/components/<whatever-you-modified>.tsx
git commit -m "feat(memory): minimal admin panel to view/delete an agent's memories"
```

---

## Task 11: Document the memory API for agent authors

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Memory section to README.md**

In `README.md`, after the "REST API" section, append:

```markdown
### Agent Memory

Agents have two tiers of memory injected into their system prompt:

**Working memory** (automatic) — the 5 most recent completed tasks for this (agent, project), formatted as a bullet list. No action needed; it's always included when the agent's system prompt contains `{{memory.recent}}`.

**Persistent memory** (opt-in) — agents write durable facts, decisions, preferences, and patterns. Retrieved via embedding similarity against the current task (Postgres + pgvector) or text match (SQLite).

```bash
# Write a memory
curl -X POST http://localhost:3000/api/agents/YOUR_AGENT_ID/memories \
  -H "Authorization: Bearer YOUR_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"category":"fact", "content":"Prod DB is at 10.0.0.5"}'

# List your memories
curl http://localhost:3000/api/agents/YOUR_AGENT_ID/memories \
  -H "Authorization: Bearer YOUR_AGENT_KEY"
```

Categories: `fact | decision | preference | pattern`.
System prompt slot: `{{memory.relevant}}` (top-5 matches against task title/description).

Memories are scoped to `(agent, project)` — an agent can't read/write another agent's memories.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(memory): document agent memory API and prompt slots"
```

---

## Self-Review Checklist (run before handoff)

- [ ] **Spec coverage:** Tier 1 working memory (Tasks 1–4), Tier 2 persistent memory write path (Tasks 5–7), Tier 2 read path (Task 8), defaults + UI + docs (Tasks 9–11). All features from the brainstorm covered.
- [ ] **No placeholders:** All steps contain concrete code or exact commands. No "TBD" / "handle edge cases" / "similar to Task N".
- [ ] **Type consistency:** `memoryContext` is `{ recent: string; relevant: string }` everywhere after Task 8 (was string-only after Task 4 — the intermediate type shifts by design, and Task 8 step 3 explicitly normalises all call sites).
- [ ] **Function signatures match across tasks:**
  - `buildWorkingMemory({ agentId, projectId, maxRecent?, maxCharsPerEntry? }): Promise<string>` — used in Tasks 1, 3, 4, 8
  - `saveMemory({ agentId, projectId, category, content, sourceTaskId?, confidence? }): Promise<AgentMemory>` — used in Tasks 6, 7
  - `searchMemories({ agentId, projectId, query, limit? }): Promise<MemoryHit[]>` — used in Task 6, called internally by `buildRelevantMemory`
  - `buildRelevantMemory({ agentId, projectId, query, limit? }): Promise<string>` — used in Tasks 6, 8
  - `reinforceMemory(id): Promise<AgentMemory>` — used in Task 6, called internally by `buildRelevantMemory`
- [ ] **Scope discipline:** No automated LLM consolidation, no cross-project sharing, no nightly job. These are explicitly out of scope for v1 and can be added later.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-agent-memory.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
