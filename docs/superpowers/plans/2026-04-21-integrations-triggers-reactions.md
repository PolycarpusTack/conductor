# Integrations: Triggers + Reactions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an MVP integrations system where project-scoped Triggers listen for internal events (or poll Sentry) and execute a sequential chain of typed Reactions (Slack, HTTP, Jira, email), with failures surfaced as toast notifications in the UI.

**Architecture:** `Trigger` records match project events by type + simple filters. When a match is found, `executeReactions` runs each `Reaction` in ascending `order`, passing rendered mustache config and merging each reaction's output into the template context for the next. Everything is fire-and-forget from the caller's perspective; failures update `consecutiveFailures`, auto-disable at 5, and broadcast `reaction-failed` so the UI can toast.

**Tech stack:** Prisma (SQLite/Postgres), bun:test + mock.module, mustache (new dep), nodemailer (new dep), shadcn/ui, socket.io-client (already present).

**Decisions locked in:**
- Templates: mustache only
- Execution: sequential by `order`, outputs merged into context as `reactions.<sanitized_name>`
- Scope: project-scoped only
- Filters: equality + one regex field (operator enum)
- Durability: fire-and-forget; queue deferred to P3
- Auth: env-var tokens only (OAuth in P4)
- Spawn feedback: deferred — top P3 priority

---

## File Map

**New files:**
- `src/lib/server/triggers/evaluator.ts` — filter matching + fire triggers
- `src/lib/server/reactions/mustache.ts` — mustache render utilities
- `src/lib/server/reactions/executor.ts` — sequential reaction execution + failure handling
- `src/lib/server/reactions/types/slack.ts` — post:slack handler
- `src/lib/server/reactions/types/http.ts` — post:http handler
- `src/lib/server/reactions/types/jira.ts` — create:jira handler
- `src/lib/server/reactions/types/email.ts` — send:email handler
- `src/lib/server/project-event.ts` — unified broadcast + trigger evaluation wrapper
- `src/lib/server/triggers/sentry-poll.ts` — Sentry API polling
- `src/app/api/projects/[id]/triggers/route.ts` — GET/POST triggers
- `src/app/api/projects/[id]/triggers/[triggerId]/route.ts` — PUT/DELETE trigger
- `src/app/api/projects/[id]/triggers/[triggerId]/reactions/route.ts` — POST reaction
- `src/app/api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]/route.ts` — PUT/DELETE reaction
- `src/app/api/projects/[id]/triggers/[triggerId]/test/route.ts` — POST test-fire
- `src/components/settings-integrations.tsx` — UI settings panel
- `src/lib/server/__tests__/trigger-evaluator.test.ts`
- `src/lib/server/__tests__/reaction-executor.test.ts`

**Modified files:**
- `prisma/schema.prisma` — add `Trigger`, `Reaction` models; add `triggers` relation to `Project`
- `src/lib/server/contracts.ts` — add Trigger + Reaction Zod schemas
- `src/lib/server/dispatch.ts` — replace `broadcastProjectEvent` with `fireProjectEvent`
- `src/lib/server/review-logic.ts` — replace `broadcastProjectEvent` with `fireProjectEvent`
- `src/app/api/tasks/route.ts` — replace `broadcastProjectEvent` with `fireProjectEvent` for `task-created`
- `src/instrumentation.ts` — register Sentry poller interval
- `src/app/page.tsx` — add Integrations tab to settings + handle `reaction-failed` socket event

---

## Task 1: Prisma schema — Trigger + Reaction models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add Trigger and Reaction models**

Open `prisma/schema.prisma`. Add these two models at the end of the file, before the final line (if there is one):

```prisma
model Trigger {
  id          String     @id @default(cuid())
  projectId   String
  project     Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name        String
  description String?
  type        String     // "event" | "poll:sentry"
  eventType   String?    // for type="event": "chain-completed" | "step-failed" | "task-created" | "step-reviewed"
  eventFilters String    @default("[]")  // JSON: TriggerFilter[]
  pollConfig  String     @default("{}") // JSON: SentryPollConfig for type="poll:sentry"
  enabled     Boolean    @default(true)
  lastFiredAt DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  reactions   Reaction[]

  @@index([projectId])
  @@index([projectId, type])
  @@index([projectId, eventType])
}

model Reaction {
  id                  String    @id @default(cuid())
  triggerId           String
  trigger             Trigger   @relation(fields: [triggerId], references: [id], onDelete: Cascade)
  name                String
  type                String    // "post:slack" | "post:http" | "create:jira" | "send:email"
  config              String    @default("{}") // JSON with mustache templates
  order               Int       @default(0)
  enabled             Boolean   @default(true)
  consecutiveFailures Int       @default(0)
  lastError           String?
  lastFiredAt         DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([triggerId, order])
}
```

- [ ] **Step 2: Add `triggers` relation to Project model**

In the `Project` model, add the relation field alongside the other one-to-many relations:

```prisma
  triggers    Trigger[]
```

- [ ] **Step 3: Run migration**

```bash
cd /mnt/c/Projects/AgentBoard
bunx prisma migrate dev --name add_triggers_reactions
```

Expected: migration file created in `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 4: Verify types generated**

```bash
bunx prisma generate
```

Expected: exits 0. The types `Trigger` and `Reaction` are now importable from `@prisma/client`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Trigger and Reaction models for integrations"
```

---

## Task 2: Zod contracts for Trigger + Reaction

**Files:**
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/__tests__/trigger-contracts.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import {
  createTriggerSchema,
  updateTriggerSchema,
  createReactionSchema,
  updateReactionSchema,
} from '../contracts'

describe('createTriggerSchema', () => {
  test('accepts valid event trigger', () => {
    const result = createTriggerSchema.safeParse({
      name: 'Chain done',
      type: 'event',
      eventType: 'chain-completed',
      eventFilters: [{ field: 'taskId', operator: 'equals', value: 'abc' }],
    })
    expect(result.success).toBe(true)
  })

  test('accepts valid sentry poll trigger', () => {
    const result = createTriggerSchema.safeParse({
      name: 'Sentry prod',
      type: 'poll:sentry',
      pollConfig: { apiTokenEnvVar: 'SENTRY_TOKEN', orgSlug: 'acme', projectSlug: 'backend' },
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = createTriggerSchema.safeParse({ name: 'x', type: 'webhook' })
    expect(result.success).toBe(false)
  })
})

describe('createReactionSchema', () => {
  test('accepts valid slack reaction', () => {
    const result = createReactionSchema.safeParse({
      name: 'Notify Slack',
      type: 'post:slack',
      config: { webhookEnvVar: 'SLACK_WEBHOOK', text: 'Done: {{event.taskId}}' },
      order: 0,
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = createReactionSchema.safeParse({ name: 'x', type: 'post:teams', config: {}, order: 0 })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test src/lib/server/__tests__/trigger-contracts.test.ts
```

Expected: FAIL — `createTriggerSchema is not exported from contracts`.

- [ ] **Step 3: Add schemas to contracts.ts**

At the end of `src/lib/server/contracts.ts`, append:

```typescript
// ── Integrations ────────────────────────────────────────────────────────────

export const triggerFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'matches']),
  value: z.string(),
})

export const triggerTypeSchema = z.enum(['event', 'poll:sentry'])

export const eventTypeSchema = z.enum([
  'chain-completed',
  'step-failed',
  'task-created',
  'step-reviewed',
])

export const reactionTypeSchema = z.enum([
  'post:slack',
  'post:http',
  'create:jira',
  'send:email',
])

export const createTriggerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  type: triggerTypeSchema,
  eventType: eventTypeSchema.optional(),
  eventFilters: z.array(triggerFilterSchema).default([]),
  pollConfig: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
})

export const updateTriggerSchema = createTriggerSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field to update',
)

export const createReactionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: reactionTypeSchema,
  config: z.record(z.unknown()),
  order: z.number().int().min(0),
  enabled: z.boolean().default(true),
})

export const updateReactionSchema = createReactionSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field to update',
)
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test src/lib/server/__tests__/trigger-contracts.test.ts
```

Expected: PASS all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/contracts.ts src/lib/server/__tests__/trigger-contracts.test.ts
git commit -m "feat(contracts): add Trigger and Reaction Zod schemas"
```

---

## Task 3: Install dependencies + mustache renderer

**Files:**
- Create: `src/lib/server/reactions/mustache.ts`

- [ ] **Step 1: Install mustache and nodemailer**

```bash
cd /mnt/c/Projects/AgentBoard
bun add mustache nodemailer
bun add -d @types/mustache @types/nodemailer
```

Expected: both appear in `package.json` dependencies.

- [ ] **Step 2: Write failing test**

Create `src/lib/server/__tests__/mustache.test.ts`:

```typescript
import { describe, test, expect } from 'bun:test'
import { renderMustache, renderConfigMustache } from '../reactions/mustache'

describe('renderMustache', () => {
  test('renders flat variables', () => {
    expect(renderMustache('Hello {{name}}!', { name: 'World' })).toBe('Hello World!')
  })

  test('renders nested paths', () => {
    expect(renderMustache('Task: {{event.taskId}}', { event: { taskId: 'abc-123' } })).toBe('Task: abc-123')
  })

  test('renders reaction output', () => {
    const ctx = { reactions: { create_jira: { issueKey: 'PROJ-42' } } }
    expect(renderMustache('Ticket: {{reactions.create_jira.issueKey}}', ctx)).toBe('Ticket: PROJ-42')
  })
})

describe('renderConfigMustache', () => {
  test('renders all string values in config', () => {
    const config = { text: 'Chain {{event.taskId}} done', url: 'https://example.com', retries: 3 }
    const result = renderConfigMustache(config, { event: { taskId: 'xyz' } })
    expect(result.text).toBe('Chain xyz done')
    expect(result.url).toBe('https://example.com')
    expect(result.retries).toBe(3)
  })

  test('recurses into nested objects', () => {
    const config = { body: { message: 'Hi {{name}}' } }
    const result = renderConfigMustache(config, { name: 'Alice' })
    expect((result.body as Record<string, unknown>).message).toBe('Hi Alice')
  })
})
```

- [ ] **Step 3: Run test — expect failure**

```bash
bun test src/lib/server/__tests__/mustache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create the mustache renderer**

Create `src/lib/server/reactions/mustache.ts`:

```typescript
import Mustache from 'mustache'

export function renderMustache(template: string, context: unknown): string {
  return Mustache.render(template, context)
}

export function renderConfigMustache(
  config: Record<string, unknown>,
  context: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = renderMustache(value, context)
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = renderConfigMustache(value as Record<string, unknown>, context)
    } else {
      result[key] = value
    }
  }
  return result
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
bun test src/lib/server/__tests__/mustache.test.ts
```

Expected: PASS all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reactions/mustache.ts src/lib/server/__tests__/mustache.test.ts package.json bun.lockb
git commit -m "feat(reactions): add mustache renderer + install mustache + nodemailer deps"
```

---

## Task 4: Trigger evaluator — filter matching

**Files:**
- Create: `src/lib/server/triggers/evaluator.ts`
- Create: `src/lib/server/__tests__/trigger-evaluator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/__tests__/trigger-evaluator.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockTriggerFindMany = mock(() => Promise.resolve([]))
const mockTriggerUpdate = mock(() => Promise.resolve({}))
const mockExecuteReactions = mock(() => Promise.resolve())

mock.module('@/lib/db', () => ({
  db: {
    trigger: {
      findMany: mockTriggerFindMany,
      update: mockTriggerUpdate,
    },
  },
}))

mock.module('@/lib/server/reactions/executor', () => ({
  executeReactions: mockExecuteReactions,
}))

import { checkAndFireTriggers } from '../triggers/evaluator'

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trig-1',
    projectId: 'proj-1',
    type: 'event',
    eventType: 'chain-completed',
    eventFilters: '[]',
    enabled: true,
    reactions: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockTriggerFindMany.mockReset()
  mockTriggerUpdate.mockReset()
  mockExecuteReactions.mockReset()
  mockTriggerFindMany.mockResolvedValue([])
  mockTriggerUpdate.mockResolvedValue({})
  mockExecuteReactions.mockResolvedValue(undefined)
})

describe('checkAndFireTriggers', () => {
  test('fires trigger with no filters when event matches', async () => {
    mockTriggerFindMany.mockResolvedValue([makeTrigger()])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'task-1' })

    // give the fire-and-forget microtask a tick
    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('does not fire when equality filter does not match', async () => {
    const filters = JSON.stringify([{ field: 'status', operator: 'equals', value: 'DONE' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'FAILED' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('fires when equality filter matches', async () => {
    const filters = JSON.stringify([{ field: 'status', operator: 'equals', value: 'DONE' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'DONE' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('fires when regex filter matches', async () => {
    const filters = JSON.stringify([{ field: 'taskId', operator: 'matches', value: '^sentry-' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'sentry-abc123' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('does not fire when regex filter does not match', async () => {
    const filters = JSON.stringify([{ field: 'taskId', operator: 'matches', value: '^sentry-' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'manual-task' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('all filters must match (AND logic)', async () => {
    const filters = JSON.stringify([
      { field: 'status', operator: 'equals', value: 'DONE' },
      { field: 'tag', operator: 'equals', value: 'critical' },
    ])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    // Only status matches, tag does not
    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'DONE', tag: 'low' })
    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('returns without firing when no triggers found', async () => {
    mockTriggerFindMany.mockResolvedValue([])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'task-1' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test src/lib/server/__tests__/trigger-evaluator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the evaluator**

Create `src/lib/server/triggers/evaluator.ts`:

```typescript
import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/utils'
import { executeReactions } from '@/lib/server/reactions/executor'

export type TriggerFilter = {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'matches'
  value: string
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function matchesFilter(payload: unknown, filter: TriggerFilter): boolean {
  const raw = getNestedValue(payload, filter.field)
  const value = raw === undefined || raw === null ? '' : String(raw)

  switch (filter.operator) {
    case 'equals':     return value === filter.value
    case 'not_equals': return value !== filter.value
    case 'contains':   return value.includes(filter.value)
    case 'not_contains': return !value.includes(filter.value)
    case 'matches': {
      try { return new RegExp(filter.value).test(value) } catch { return false }
    }
  }
}

export async function checkAndFireTriggers(
  projectId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const triggers = await db.trigger.findMany({
    where: { projectId, type: 'event', eventType, enabled: true },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  for (const trigger of triggers) {
    const filters = safeJsonParse<TriggerFilter[]>(trigger.eventFilters, [])
    const matches = filters.every(f => matchesFilter(payload, f))
    if (!matches) continue

    const taskId = (payload as Record<string, unknown>)?.taskId as string | undefined

    executeReactions(trigger, payload, taskId).catch(() => {})
    await db.trigger.update({ where: { id: trigger.id }, data: { lastFiredAt: new Date() } })
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test src/lib/server/__tests__/trigger-evaluator.test.ts
```

Expected: PASS all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/triggers/evaluator.ts src/lib/server/__tests__/trigger-evaluator.test.ts
git commit -m "feat(triggers): add trigger evaluator with filter matching"
```

---

## Task 5: Reaction executor — sequential execution

**Files:**
- Create: `src/lib/server/reactions/executor.ts`
- Create: `src/lib/server/__tests__/reaction-executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/__tests__/reaction-executor.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockReactionUpdate = mock(() => Promise.resolve({}))
const mockBroadcast = mock(() => Promise.resolve())
const mockExecuteSlack = mock(() => Promise.resolve({ ok: true }))
const mockExecuteHttp = mock(() => Promise.resolve({ status: 200, ok: true }))

mock.module('@/lib/db', () => ({
  db: { reaction: { update: mockReactionUpdate } },
}))
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcast,
}))
mock.module('@/lib/server/reactions/types/slack', () => ({
  executeSlackReaction: mockExecuteSlack,
}))
mock.module('@/lib/server/reactions/types/http', () => ({
  executeHttpReaction: mockExecuteHttp,
}))
mock.module('@/lib/server/reactions/types/jira', () => ({
  executeJiraReaction: mock(() => Promise.resolve({ issueKey: 'PROJ-1' })),
}))
mock.module('@/lib/server/reactions/types/email', () => ({
  executeEmailReaction: mock(() => Promise.resolve({ sent: true })),
}))

import { executeReactions } from '../reactions/executor'

function makeReaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rxn-1',
    triggerId: 'trig-1',
    name: 'Notify Slack',
    type: 'post:slack',
    config: JSON.stringify({ webhookEnvVar: 'SLACK_WEBHOOK', text: 'Done: {{event.taskId}}' }),
    order: 0,
    enabled: true,
    consecutiveFailures: 0,
    lastError: null,
    ...overrides,
  }
}

function makeTrigger(reactions: ReturnType<typeof makeReaction>[] = []) {
  return {
    id: 'trig-1',
    projectId: 'proj-1',
    reactions,
  }
}

beforeEach(() => {
  mockReactionUpdate.mockReset()
  mockBroadcast.mockReset()
  mockExecuteSlack.mockReset()
  mockExecuteHttp.mockReset()
  mockReactionUpdate.mockResolvedValue({})
  mockBroadcast.mockResolvedValue(undefined)
  mockExecuteSlack.mockResolvedValue({ ok: true })
  mockExecuteHttp.mockResolvedValue({ status: 200, ok: true })
})

describe('executeReactions', () => {
  test('executes a slack reaction and resets consecutiveFailures', async () => {
    const trigger = makeTrigger([makeReaction()])
    await executeReactions(trigger as any, { taskId: 'task-1' }, 'task-1')

    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0, lastError: null }),
      }),
    )
  })

  test('merges previous reaction output into context for next reaction', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'First HTTP', type: 'post:http', order: 0 })
    const r2 = makeReaction({ id: 'rxn-2', name: 'Notify Slack', type: 'post:slack', order: 1 })
    const trigger = makeTrigger([r1, r2])

    mockExecuteHttp.mockResolvedValue({ status: 200, ok: true })

    await executeReactions(trigger as any, { taskId: 't1' }, 't1')

    // Both reactions should fire
    expect(mockExecuteHttp).toHaveBeenCalledTimes(1)
    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
  })

  test('stops after first failure and increments consecutiveFailures', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Fail', type: 'post:slack', order: 0 })
    const r2 = makeReaction({ id: 'rxn-2', name: 'Should not run', type: 'post:http', order: 1 })
    const trigger = makeTrigger([r1, r2])

    mockExecuteSlack.mockRejectedValue(new Error('Slack is down'))

    await executeReactions(trigger as any, { taskId: 't1' }, 't1')

    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
    expect(mockExecuteHttp).not.toHaveBeenCalled()
    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 1, lastError: 'Slack is down' }),
      }),
    )
  })

  test('disables reaction after 5 consecutive failures', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Flakey', type: 'post:slack', order: 0, consecutiveFailures: 4 })
    const trigger = makeTrigger([r1])
    mockExecuteSlack.mockRejectedValue(new Error('down'))

    await executeReactions(trigger as any, {}, undefined)

    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false }),
      }),
    )
  })

  test('broadcasts reaction-failed with taskId when failure occurs', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Bad', type: 'post:slack', order: 0 })
    const trigger = makeTrigger([r1])
    mockExecuteSlack.mockRejectedValue(new Error('oops'))

    await executeReactions(trigger as any, {}, 'task-42')

    expect(mockBroadcast).toHaveBeenCalledWith(
      'proj-1',
      'reaction-failed',
      expect.objectContaining({ taskId: 'task-42', error: 'oops' }),
    )
  })

  test('does not broadcast reaction-failed when taskId is undefined', async () => {
    const trigger = makeTrigger([makeReaction()])
    mockExecuteSlack.mockRejectedValue(new Error('oops'))

    await executeReactions(trigger as any, {}, undefined)

    expect(mockBroadcast).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
bun test src/lib/server/__tests__/reaction-executor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the executor**

Create `src/lib/server/reactions/executor.ts`:

```typescript
import type { Trigger, Reaction } from '@prisma/client'
import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/utils'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { renderConfigMustache } from './mustache'
import { executeSlackReaction } from './types/slack'
import { executeHttpReaction } from './types/http'
import { executeJiraReaction } from './types/jira'
import { executeEmailReaction } from './types/email'

type ReactionOutput = Record<string, unknown>

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

async function dispatchReaction(type: string, config: Record<string, unknown>): Promise<ReactionOutput> {
  switch (type) {
    case 'post:slack':   return executeSlackReaction(config)
    case 'post:http':    return executeHttpReaction(config)
    case 'create:jira':  return executeJiraReaction(config)
    case 'send:email':   return executeEmailReaction(config)
    default: throw new Error(`Unknown reaction type: ${type}`)
  }
}

export async function executeReactions(
  trigger: Trigger & { reactions: Reaction[] },
  eventPayload: unknown,
  taskId: string | undefined,
): Promise<void> {
  const context: Record<string, unknown> = {
    event: eventPayload,
    reactions: {} as Record<string, unknown>,
  }

  for (const reaction of trigger.reactions) {
    const rawConfig = safeJsonParse<Record<string, unknown>>(reaction.config, {})
    const renderedConfig = renderConfigMustache(rawConfig, context)

    try {
      const output = await dispatchReaction(reaction.type, renderedConfig)
      ;(context.reactions as Record<string, unknown>)[sanitizeName(reaction.name)] = output

      await db.reaction.update({
        where: { id: reaction.id },
        data: { consecutiveFailures: 0, lastFiredAt: new Date(), lastError: null },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const newFailures = reaction.consecutiveFailures + 1

      await db.reaction.update({
        where: { id: reaction.id },
        data: {
          consecutiveFailures: newFailures,
          lastError: errorMessage,
          ...(newFailures >= 5 ? { enabled: false } : {}),
        },
      })

      if (taskId) {
        broadcastProjectEvent(trigger.projectId, 'reaction-failed', {
          taskId,
          triggerId: trigger.id,
          reactionId: reaction.id,
          reactionName: reaction.name,
          error: errorMessage,
        })
      }

      break
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
bun test src/lib/server/__tests__/reaction-executor.test.ts
```

Expected: PASS all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reactions/executor.ts src/lib/server/__tests__/reaction-executor.test.ts
git commit -m "feat(reactions): add sequential reaction executor with failure handling"
```

---

## Task 6: Reaction type handlers

**Files:**
- Create: `src/lib/server/reactions/types/slack.ts`
- Create: `src/lib/server/reactions/types/http.ts`
- Create: `src/lib/server/reactions/types/jira.ts`
- Create: `src/lib/server/reactions/types/email.ts`

These are pure HTTP handlers with no complex logic; no unit tests needed (they're just `fetch` wrappers). Integration-test them via the test-fire endpoint in Task 9.

- [ ] **Step 1: Create slack handler**

Create `src/lib/server/reactions/types/slack.ts`:

```typescript
export async function executeSlackReaction(config: Record<string, unknown>): Promise<{ ok: true }> {
  const webhookUrl = process.env[config.webhookEnvVar as string]
  if (!webhookUrl) throw new Error(`Env var "${config.webhookEnvVar}" is not set`)

  const body: Record<string, unknown> = { text: config.text as string }
  if (config.blocks) body.blocks = config.blocks

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`)
  return { ok: true }
}
```

- [ ] **Step 2: Create HTTP handler**

Create `src/lib/server/reactions/types/http.ts`:

```typescript
export async function executeHttpReaction(
  config: Record<string, unknown>,
): Promise<{ status: number; ok: true }> {
  const url = config.url as string
  if (!url) throw new Error('post:http reaction requires a "url" field')

  const method = (config.method as string) || 'POST'
  const headers = (config.headers as Record<string, string>) || {}

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
  })

  if (!res.ok) throw new Error(`HTTP request to ${url} failed: ${res.status} ${res.statusText}`)
  return { status: res.status, ok: true }
}
```

- [ ] **Step 3: Create Jira handler**

Create `src/lib/server/reactions/types/jira.ts`:

```typescript
export async function executeJiraReaction(
  config: Record<string, unknown>,
): Promise<{ issueKey: string; issueId: string; issueUrl: string }> {
  const domain    = process.env[config.domainEnvVar as string]
  const email     = process.env[config.emailEnvVar as string]
  const apiToken  = process.env[config.apiTokenEnvVar as string]

  if (!domain)   throw new Error(`Env var "${config.domainEnvVar}" is not set`)
  if (!email)    throw new Error(`Env var "${config.emailEnvVar}" is not set`)
  if (!apiToken) throw new Error(`Env var "${config.apiTokenEnvVar}" is not set`)

  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64')

  const res = await fetch(`${domain}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      fields: {
        project:   { key: config.projectKey as string },
        summary:   config.summary as string,
        issuetype: { name: (config.issueType as string) || 'Task' },
        ...(config.description
          ? {
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: config.description as string }],
                  },
                ],
              },
            }
          : {}),
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Jira API failed: ${res.status} — ${body}`)
  }

  const issue = (await res.json()) as { key: string; id: string; self: string }
  return { issueKey: issue.key, issueId: issue.id, issueUrl: issue.self }
}
```

- [ ] **Step 4: Create email handler**

Create `src/lib/server/reactions/types/email.ts`:

```typescript
import nodemailer from 'nodemailer'

export async function executeEmailReaction(config: Record<string, unknown>): Promise<{ sent: true }> {
  const host = process.env[config.smtpHostEnvVar as string]
  if (!host) throw new Error(`Env var "${config.smtpHostEnvVar}" is not set`)

  const port = Number(process.env[config.smtpPortEnvVar as string] ?? '587')
  const user = process.env[config.smtpUserEnvVar as string]
  const pass = process.env[config.smtpPassEnvVar as string]

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  })

  await transporter.sendMail({
    from:    config.from as string,
    to:      config.to as string,
    subject: config.subject as string,
    text:    config.text as string,
    ...(config.html ? { html: config.html as string } : {}),
  })

  return { sent: true }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reactions/types/
git commit -m "feat(reactions): add slack, http, jira, email reaction handlers"
```

---

## Task 7: Unified project event — hook triggers into dispatch

Create a thin wrapper so all broadcastable events can optionally fire triggers, then replace the key call sites.

**Files:**
- Create: `src/lib/server/project-event.ts`
- Modify: `src/lib/server/dispatch.ts`
- Modify: `src/lib/server/review-logic.ts`
- Modify: `src/app/api/tasks/route.ts`

- [ ] **Step 1: Create project-event.ts**

Create `src/lib/server/project-event.ts`:

```typescript
import { broadcastProjectEvent } from './realtime'
import { checkAndFireTriggers } from './triggers/evaluator'

const TRIGGERABLE = new Set([
  'chain-completed',
  'step-failed',
  'task-created',
  'step-reviewed',
])

export async function fireProjectEvent(
  projectId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  await broadcastProjectEvent(projectId, event, payload)
  if (TRIGGERABLE.has(event)) {
    checkAndFireTriggers(projectId, event, payload).catch(() => {})
  }
}
```

- [ ] **Step 2: Replace broadcastProjectEvent in dispatch.ts**

In `src/lib/server/dispatch.ts`:

Replace the import line:
```typescript
import { broadcastProjectEvent } from '@/lib/server/realtime'
```
with:
```typescript
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
```

This keeps all existing call sites unchanged — they'll now go through `fireProjectEvent` automatically.

- [ ] **Step 3: Replace broadcastProjectEvent in review-logic.ts**

In `src/lib/server/review-logic.ts`, replace:
```typescript
import { broadcastProjectEvent } from '@/lib/server/realtime'
```
with:
```typescript
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
```

- [ ] **Step 4: Replace broadcastProjectEvent for task-created in tasks/route.ts**

In `src/app/api/tasks/route.ts`, add the import alongside the existing realtime import (or replace it if `broadcastProjectEvent` is the only thing imported from realtime):

```typescript
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
```

Remove the old `import { broadcastProjectEvent } from '@/lib/server/realtime'` line.

- [ ] **Step 5: Run existing dispatch tests to verify nothing broke**

```bash
bun test src/lib/server/__tests__/dispatch-logic.test.ts
```

Expected: PASS (existing tests). If they fail due to the import alias change, update the mock target in those tests from `@/lib/server/realtime` to also mock `@/lib/server/project-event` with `broadcastProjectEvent`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/project-event.ts src/lib/server/dispatch.ts src/lib/server/review-logic.ts src/app/api/tasks/route.ts
git commit -m "feat(triggers): wire trigger evaluation into project event broadcast path"
```

---

## Task 8: Trigger + Reaction CRUD API routes

**Files:**
- Create: `src/app/api/projects/[id]/triggers/route.ts`
- Create: `src/app/api/projects/[id]/triggers/[triggerId]/route.ts`
- Create: `src/app/api/projects/[id]/triggers/[triggerId]/reactions/route.ts`
- Create: `src/app/api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]/route.ts`

- [ ] **Step 1: Create trigger list + create route**

Create `src/app/api/projects/[id]/triggers/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createTriggerSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorHandling<Ctx>('api/projects/[id]/triggers', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId } = await params
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw notFound('Project not found')

  const triggers = await db.trigger.findMany({
    where: { projectId },
    include: { reactions: { orderBy: { order: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(triggers)
})

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId } = await params
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw notFound('Project not found')

  const parsed = createTriggerSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid trigger payload')

  const { eventFilters, pollConfig, ...rest } = parsed.data
  const trigger = await db.trigger.create({
    data: {
      ...rest,
      projectId,
      eventFilters: JSON.stringify(eventFilters),
      pollConfig: JSON.stringify(pollConfig),
    },
    include: { reactions: true },
  })

  return NextResponse.json(trigger, { status: 201 })
})
```

- [ ] **Step 2: Create trigger update + delete route**

Create `src/app/api/projects/[id]/triggers/[triggerId]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateTriggerSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const PUT = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const existing = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!existing) throw notFound('Trigger not found')

  const parsed = updateTriggerSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid payload')

  const { eventFilters, pollConfig, ...rest } = parsed.data
  const trigger = await db.trigger.update({
    where: { id: triggerId },
    data: {
      ...rest,
      ...(eventFilters !== undefined ? { eventFilters: JSON.stringify(eventFilters) } : {}),
      ...(pollConfig !== undefined ? { pollConfig: JSON.stringify(pollConfig) } : {}),
    },
    include: { reactions: { orderBy: { order: 'asc' } } },
  })

  return NextResponse.json(trigger)
})

export const DELETE = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const existing = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!existing) throw notFound('Trigger not found')

  await db.trigger.delete({ where: { id: triggerId } })
  return NextResponse.json({ deleted: true })
})
```

- [ ] **Step 3: Create reaction create route**

Create `src/app/api/projects/[id]/triggers/[triggerId]/reactions/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound, conflict } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createReactionSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const trigger = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!trigger) throw notFound('Trigger not found')

  const parsed = createReactionSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reaction payload')

  const existing = await db.reaction.findFirst({ where: { triggerId, order: parsed.data.order } })
  if (existing) throw conflict(`A reaction with order ${parsed.data.order} already exists on this trigger`)

  const { config, ...rest } = parsed.data
  const reaction = await db.reaction.create({
    data: { ...rest, triggerId, config: JSON.stringify(config) },
  })

  return NextResponse.json(reaction, { status: 201 })
})
```

- [ ] **Step 4: Create reaction update + delete route**

Create `src/app/api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateReactionSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string; reactionId: string }> }

export const PUT = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId, reactionId } = await params
  const existing = await db.reaction.findFirst({
    where: { id: reactionId, triggerId, trigger: { projectId } },
  })
  if (!existing) throw notFound('Reaction not found')

  const parsed = updateReactionSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid payload')

  const { config, ...rest } = parsed.data
  const reaction = await db.reaction.update({
    where: { id: reactionId },
    data: {
      ...rest,
      ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
    },
  })

  return NextResponse.json(reaction)
})

export const DELETE = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId, reactionId } = await params
  const existing = await db.reaction.findFirst({
    where: { id: reactionId, triggerId, trigger: { projectId } },
  })
  if (!existing) throw notFound('Reaction not found')

  await db.reaction.delete({ where: { id: reactionId } })
  return NextResponse.json({ deleted: true })
})
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/projects/
git commit -m "feat(api): add Trigger and Reaction CRUD routes"
```

---

## Task 9: Test-fire endpoint

**Files:**
- Create: `src/app/api/projects/[id]/triggers/[triggerId]/test/route.ts`

- [ ] **Step 1: Create the test-fire endpoint**

Create `src/app/api/projects/[id]/triggers/[triggerId]/test/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { executeReactions } from '@/lib/server/reactions/executor'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/test', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const trigger = await db.trigger.findFirst({
    where: { id: triggerId, projectId },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  if (!trigger) throw notFound('Trigger not found')

  const body = await request.json().catch(() => ({}))
  const payload = (body as Record<string, unknown>).payload ?? {}

  await executeReactions(trigger, payload, undefined)
  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 2: Verify the endpoint exists**

```bash
ls src/app/api/projects/\[id\]/triggers/\[triggerId\]/test/
```

Expected: `route.ts` is listed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/projects/\[id\]/triggers/\[triggerId\]/test/
git commit -m "feat(api): add trigger test-fire endpoint"
```

---

## Task 10: Sentry poll handler + instrumentation

**Files:**
- Create: `src/lib/server/triggers/sentry-poll.ts`
- Modify: `src/instrumentation.ts`

- [ ] **Step 1: Create the Sentry poller**

Create `src/lib/server/triggers/sentry-poll.ts`:

```typescript
import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/utils'
import { executeReactions } from '@/lib/server/reactions/executor'

type SentryPollConfig = {
  apiTokenEnvVar: string
  orgSlug: string
  projectSlug: string
  environment?: string
}

type SentryIssue = {
  id: string
  title: string
  permalink: string
  level: string
  culprit: string
  firstSeen: string
  lastSeen: string
}

export async function pollSentryTriggers(): Promise<void> {
  const triggers = await db.trigger.findMany({
    where: { type: 'poll:sentry', enabled: true },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  for (const trigger of triggers) {
    const config = safeJsonParse<SentryPollConfig>(trigger.pollConfig, {} as SentryPollConfig)
    const apiToken = config.apiTokenEnvVar ? process.env[config.apiTokenEnvVar] : undefined

    if (!apiToken || !config.orgSlug || !config.projectSlug) continue

    const since = trigger.lastFiredAt
      ? trigger.lastFiredAt.toISOString()
      : new Date(Date.now() - 60_000).toISOString()

    const url = new URL(
      `https://sentry.io/api/0/projects/${encodeURIComponent(config.orgSlug)}/${encodeURIComponent(config.projectSlug)}/issues/`,
    )
    url.searchParams.set('query', `firstSeen:>${since}`)
    if (config.environment) url.searchParams.set('environment', config.environment)

    let issues: SentryIssue[]
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiToken}` },
      })
      if (!res.ok) continue
      issues = (await res.json()) as SentryIssue[]
    } catch {
      continue
    }

    for (const issue of issues) {
      const payload = {
        id: issue.id,
        title: issue.title,
        url: issue.permalink,
        level: issue.level,
        culprit: issue.culprit,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
      }
      await executeReactions(trigger, payload, undefined)
    }

    if (issues.length > 0) {
      await db.trigger.update({ where: { id: trigger.id }, data: { lastFiredAt: new Date() } })
    }
  }
}
```

- [ ] **Step 2: Register the poller in instrumentation.ts**

In `src/instrumentation.ts`, the file currently reads:

```typescript
export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('@/lib/server/scheduler')
    await initializeScheduler()
  }
}
```

Add the Sentry poller call after `initializeScheduler()`:

```typescript
export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('@/lib/server/scheduler')
    await initializeScheduler()

    const { pollSentryTriggers } = await import('@/lib/server/triggers/sentry-poll')
    const SENTRY_POLL_INTERVAL_MS = 60_000
    setInterval(() => { pollSentryTriggers().catch(() => {}) }, SENTRY_POLL_INTERVAL_MS)
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/triggers/sentry-poll.ts src/instrumentation.ts
git commit -m "feat(triggers): add Sentry poll handler and register interval in instrumentation"
```

---

## Task 11: UI — Integrations settings tab + reaction-failed banner

**Files:**
- Create: `src/components/settings-integrations.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create settings-integrations.tsx**

Create `src/components/settings-integrations.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'

type TriggerFilter = {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'matches'
  value: string
}

type Reaction = {
  id: string
  name: string
  type: 'post:slack' | 'post:http' | 'create:jira' | 'send:email'
  config: Record<string, unknown>
  order: number
  enabled: boolean
  consecutiveFailures: number
  lastError: string | null
}

type Trigger = {
  id: string
  name: string
  description?: string
  type: 'event' | 'poll:sentry'
  eventType?: string
  eventFilters: string
  pollConfig: string
  enabled: boolean
  lastFiredAt?: string
  reactions: Reaction[]
}

const EVENT_TYPES = [
  { value: 'chain-completed', label: 'Chain completed' },
  { value: 'step-failed', label: 'Step failed' },
  { value: 'task-created', label: 'Task created' },
  { value: 'step-reviewed', label: 'Step reviewed' },
]

const REACTION_TYPES = [
  { value: 'post:slack', label: 'Post to Slack' },
  { value: 'post:http', label: 'HTTP request' },
  { value: 'create:jira', label: 'Create Jira issue' },
  { value: 'send:email', label: 'Send email' },
]

type Props = {
  projectId: string
  triggers: Trigger[]
  onTriggersChange: (triggers: Trigger[]) => void
}

function statusDot(trigger: Trigger) {
  if (!trigger.enabled) return <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
  const hasErrors = trigger.reactions.some(r => r.consecutiveFailures > 0)
  if (hasErrors) return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
  return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
}

function ReactionRow({
  reaction,
  triggerId,
  projectId,
  onUpdate,
  onDelete,
}: {
  reaction: Reaction
  triggerId: string
  projectId: string
  onUpdate: (r: Reaction) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [config, setConfig] = useState(JSON.stringify(reaction.config, null, 2))
  const [name, setName] = useState(reaction.name)

  const save = async () => {
    let parsedConfig: Record<string, unknown>
    try { parsedConfig = JSON.parse(config) } catch { alert('Config is not valid JSON'); return }

    const res = await fetch(
      `/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: parsedConfig }),
      },
    )
    if (!res.ok) return
    const updated = await res.json() as Reaction
    updated.config = parsedConfig
    onUpdate(updated)
    setEditing(false)
  }

  const remove = async () => {
    if (!confirm(`Delete reaction "${reaction.name}"?`)) return
    await fetch(`/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`, {
      method: 'DELETE',
    })
    onDelete(reaction.id)
  }

  const toggleEnabled = async () => {
    const res = await fetch(
      `/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !reaction.enabled }),
      },
    )
    if (!res.ok) return
    onUpdate({ ...reaction, enabled: !reaction.enabled })
  }

  return (
    <div className="border rounded p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{reaction.name}</span>
          <Badge variant="outline">{reaction.type}</Badge>
          <span className="text-muted-foreground">order {reaction.order}</span>
          {reaction.consecutiveFailures > 0 && (
            <Badge variant="destructive">{reaction.consecutiveFailures} failures</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={reaction.enabled} onCheckedChange={toggleEnabled} />
          <Button variant="ghost" size="sm" onClick={() => setEditing(e => !e)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </div>
      </div>
      {reaction.lastError && (
        <p className="text-destructive text-xs">Last error: {reaction.lastError}</p>
      )}
      {editing && (
        <div className="space-y-2 pt-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <Label>Config (JSON with mustache templates)</Label>
            <Textarea
              value={config}
              onChange={e => setConfig(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function TriggerCard({
  trigger,
  projectId,
  onUpdate,
  onDelete,
}: {
  trigger: Trigger
  projectId: string
  onUpdate: (t: Trigger) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [addingReaction, setAddingReaction] = useState(false)
  const [newRxnName, setNewRxnName] = useState('')
  const [newRxnType, setNewRxnType] = useState<string>('post:slack')
  const [newRxnConfig, setNewRxnConfig] = useState('{}')
  const [newRxnOrder, setNewRxnOrder] = useState(trigger.reactions.length)
  const [testing, setTesting] = useState(false)

  const toggleEnabled = async () => {
    const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !trigger.enabled }),
    })
    if (!res.ok) return
    onUpdate({ ...trigger, enabled: !trigger.enabled })
  }

  const removeTrigger = async () => {
    if (!confirm(`Delete trigger "${trigger.name}"?`)) return
    await fetch(`/api/projects/${projectId}/triggers/${trigger.id}`, { method: 'DELETE' })
    onDelete(trigger.id)
  }

  const testFire = async () => {
    setTesting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      })
      if (res.ok) alert('Test fired successfully')
      else {
        const err = await res.json() as { error?: string }
        alert(`Test failed: ${err.error ?? 'Unknown error'}`)
      }
    } finally {
      setTesting(false)
    }
  }

  const addReaction = async () => {
    let parsedConfig: Record<string, unknown>
    try { parsedConfig = JSON.parse(newRxnConfig) } catch { alert('Config is not valid JSON'); return }

    const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRxnName, type: newRxnType, config: parsedConfig, order: newRxnOrder }),
    })
    if (!res.ok) { const e = await res.json() as { error?: string }; alert(e.error); return }
    const created = await res.json() as Reaction
    created.config = parsedConfig
    onUpdate({ ...trigger, reactions: [...trigger.reactions, created] })
    setAddingReaction(false)
    setNewRxnName('')
    setNewRxnConfig('{}')
    setNewRxnOrder(trigger.reactions.length + 1)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left">
          {statusDot(trigger)}
          <span className="font-medium">{trigger.name}</span>
          <Badge variant="outline">{trigger.type === 'poll:sentry' ? 'Sentry poll' : trigger.eventType}</Badge>
          <span className="text-muted-foreground text-xs">{trigger.reactions.length} reactions</span>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2">
          <Switch checked={trigger.enabled} onCheckedChange={toggleEnabled} />
          <Button variant="outline" size="sm" disabled={testing} onClick={testFire}>
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button variant="ghost" size="sm" onClick={removeTrigger}>Delete</Button>
        </div>
      </div>

      <CollapsibleContent className="space-y-2 pt-2">
        <div className="space-y-2">
          {trigger.reactions.map(r => (
            <ReactionRow
              key={r.id}
              reaction={r}
              triggerId={trigger.id}
              projectId={projectId}
              onUpdate={updated =>
                onUpdate({ ...trigger, reactions: trigger.reactions.map(x => x.id === updated.id ? updated : x) })
              }
              onDelete={id => onUpdate({ ...trigger, reactions: trigger.reactions.filter(x => x.id !== id) })}
            />
          ))}
        </div>

        {addingReaction ? (
          <div className="border rounded p-3 space-y-2 text-sm">
            <p className="font-medium">New reaction</p>
            <div>
              <Label>Name</Label>
              <Input value={newRxnName} onChange={e => setNewRxnName(e.target.value)} placeholder="Notify Slack" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={newRxnType} onValueChange={setNewRxnType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REACTION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Order</Label>
              <Input type="number" value={newRxnOrder} onChange={e => setNewRxnOrder(Number(e.target.value))} />
            </div>
            <div>
              <Label>Config (JSON)</Label>
              <Textarea
                value={newRxnConfig}
                onChange={e => setNewRxnConfig(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder='{"webhookEnvVar": "SLACK_WEBHOOK", "text": "Chain {{event.taskId}} completed"}'
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addReaction}>Add reaction</Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingReaction(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingReaction(true)}>+ Add reaction</Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsIntegrations({ projectId, triggers, onTriggersChange }: Props) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'event' | 'poll:sentry'>('event')
  const [newEventType, setNewEventType] = useState('chain-completed')
  const [newPollConfig, setNewPollConfig] = useState('{}')

  const createTrigger = async () => {
    const body: Record<string, unknown> = { name: newName, type: newType }
    if (newType === 'event') {
      body.eventType = newEventType
    } else {
      try { body.pollConfig = JSON.parse(newPollConfig) } catch { alert('Poll config is not valid JSON'); return }
    }

    const res = await fetch(`/api/projects/${projectId}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json() as { error?: string }; alert(e.error); return }
    const created = await res.json() as Trigger
    onTriggersChange([...triggers, created])
    setCreating(false)
    setNewName('')
    setNewPollConfig('{}')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Integrations</h3>
        <Button size="sm" onClick={() => setCreating(c => !c)}>+ New trigger</Button>
      </div>

      {creating && (
        <div className="border rounded p-4 space-y-3 text-sm">
          <p className="font-medium">New trigger</p>
          <div>
            <Label>Name</Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Chain done → Slack" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={newType} onValueChange={v => setNewType(v as 'event' | 'poll:sentry')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="event">Internal event</SelectItem>
                <SelectItem value="poll:sentry">Sentry poll</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newType === 'event' && (
            <div>
              <Label>Event type</Label>
              <Select value={newEventType} onValueChange={setNewEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {newType === 'poll:sentry' && (
            <div>
              <Label>Poll config (JSON)</Label>
              <Textarea
                value={newPollConfig}
                onChange={e => setNewPollConfig(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder='{"apiTokenEnvVar": "SENTRY_TOKEN", "orgSlug": "acme", "projectSlug": "backend"}'
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={createTrigger}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {triggers.length === 0 && !creating && (
        <p className="text-muted-foreground text-sm">No triggers yet. Create one to start automating reactions.</p>
      )}

      <div className="space-y-2">
        {triggers.map(t => (
          <TriggerCard
            key={t.id}
            trigger={t}
            projectId={projectId}
            onUpdate={updated => onTriggersChange(triggers.map(x => x.id === updated.id ? updated : x))}
            onDelete={id => onTriggersChange(triggers.filter(x => x.id !== id))}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Integrations tab to settings in page.tsx**

In `src/app/page.tsx`:

**2a.** Add the import near the other settings component imports:

```typescript
import { SettingsIntegrations } from '@/components/settings-integrations'
```

**2b.** Add `triggers` state near the other project-data state (search for where `templates` or `modes` state is initialized):

```typescript
const [triggers, setTriggers] = useState<Trigger[]>([])
```

You'll also need to add `Trigger` as a type — define it inline or import from the component.

**2c.** Fetch triggers when the project loads. Find where `templates` or `modes` are fetched (likely in the `useEffect` or data-loading section that runs when `currentProjectId` changes). Add:

```typescript
const triggersRes = await fetch(`/api/projects/${projectId}/triggers`)
if (triggersRes.ok) setTriggers(await triggersRes.json())
```

**2d.** In the settings panel, find where the settings tabs are rendered (look for `<Tabs>` with values like `modes`, `runtimes`, `mcp`, `templates`, `automation`). Add a new tab trigger and content:

```tsx
<TabsTrigger value="integrations">Integrations</TabsTrigger>
```

```tsx
<TabsContent value="integrations">
  <SettingsIntegrations
    projectId={currentProjectId}
    triggers={triggers}
    onTriggersChange={setTriggers}
  />
</TabsContent>
```

- [ ] **Step 3: Handle reaction-failed socket event for the toast banner**

**3a.** In `src/app/page.tsx`, add the import for `useToast` near the top (with other hook imports):

```typescript
import { useToast } from '@/hooks/use-toast'
```

**3b.** Inside the component, destructure `toast`:

```typescript
const { toast } = useToast()
```

**3c.** Inside the socket initialization block (where other `activeSocket.on(...)` calls are), add:

```typescript
activeSocket.on('reaction-failed', (data: {
  taskId: string
  reactionName: string
  error: string
}) => {
  toast({
    title: `Reaction failed: ${data.reactionName}`,
    description: data.error,
    variant: 'destructive',
  })
})
```

- [ ] **Step 4: Start the dev server and verify**

```bash
bun dev
```

Open the browser, navigate to a project, open Settings, and verify the Integrations tab appears. Create a trigger and reaction. Click "Test" — verify the button fires without a crash (reactions will fail if env vars aren't set, which is expected).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings-integrations.tsx src/app/page.tsx
git commit -m "feat(ui): add Integrations settings tab with Trigger/Reaction CRUD and reaction-failed toast"
```

---

## Self-Review

After Task 11, re-read the design doc (`docs/designs/integrations.md`) MVP section and verify:

**Spec coverage:**
- [x] `Trigger` model + CRUD — Tasks 1, 8
- [x] Event trigger matching — Task 4
- [x] `Reaction` model + CRUD — Tasks 1, 8
- [x] Sequential execution with `order` + context merging — Task 5
- [x] Mustache templates — Task 3
- [x] `post:slack` — Task 6
- [x] `post:http` — Task 6
- [x] `create:jira` — Task 6
- [x] `send:email` — Task 6
- [x] Auto-disable at 5 consecutive failures — Task 5
- [x] Failure banner on relevant task — Task 11
- [x] Test-fire endpoint — Task 9
- [x] Sentry poll trigger — Task 10
- [x] UI with enable/disable + test button — Task 11
- [x] Project-scoped — all routes scoped to `projectId`
- [x] Env-var auth only (no OAuth) — all reaction handlers use `process.env`

**P3 note:** `spawn:chain` reaction with parent notification is deferred — flagged as top P3 priority in the design doc.
