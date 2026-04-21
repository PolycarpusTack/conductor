# HTTP-Poll Agent Live Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTTP-poll agents emit the same live-activity events as daemon agents, so a single socket stream covers both integration paths and future Kanban-side UI only needs one listener.

**Architecture:** Mirror the existing daemon pipeline. Rename `daemonEventSchema` → `liveAgentEventSchema` (with one-release alias), rename the socket event `daemon-agent-event` → `agent-live-event`, add a `source: 'daemon' | 'http'` discriminator to payloads, and add `POST /api/agent/events` with agent-Bearer auth that mirrors the daemon endpoint. No UI component changes; only the state/prop shape on page.tsx and runtime-dashboard.tsx widens.

**Tech Stack:** Next.js 16, Prisma 7, bun:test, Zod 4, socket.io (mini-service at `mini-services/board-ws`).

**Source spec:** `docs/superpowers/specs/2026-04-21-http-agent-live-events-design.md`.

---

## File Structure

**New files**
- `src/app/api/agent/events/route.ts` — POST handler for HTTP-poll agent live events.
- `src/lib/server/__tests__/agent-events-route.test.ts` — unit tests (mock-module pattern, mirrors `daemon-events-route.test.ts`).

**Modified files**
- `src/lib/server/daemon-contracts.ts` — rename `daemonEventSchema` → `liveAgentEventSchema`, add alias re-export for one release cycle.
- `src/app/api/daemon/events/route.ts` — import renamed schema; switch broadcast event name; add `source: 'daemon'` to payload.
- `src/app/page.tsx` — rename listener, state, inline type, prop handoff.
- `src/components/runtime-dashboard.tsx` — rename prop + local type to match new shape (filter at line 209 unchanged — HTTP events lack `daemonId` so they're naturally excluded from daemon-scoped view).

---

## Task 1: Rename schema with backward-compat alias

**Files:**
- Modify: `src/lib/server/daemon-contracts.ts`

- [ ] **Step 1: Read current state**

Read `src/lib/server/daemon-contracts.ts` and confirm the `daemonEventSchema` export sits around line 25 (discriminated union with 6 types).

- [ ] **Step 2: Rename export + add alias**

Locate this block (around line 25-50):

```typescript
export const daemonEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking') }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    ok: z.boolean(),
    output: z.string().max(5000),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    chunk: z.string().max(5000),
  }),
  z.object({
    type: z.literal('completed'),
    summary: z.string().max(5000).optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().max(5000),
  }),
])
```

Change the export name and add a back-compat alias directly below it:

```typescript
export const liveAgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking') }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    ok: z.boolean(),
    output: z.string().max(5000),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    chunk: z.string().max(5000),
  }),
  z.object({
    type: z.literal('completed'),
    summary: z.string().max(5000).optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().max(5000),
  }),
])

/** @deprecated Use liveAgentEventSchema. Kept for one release cycle. */
export const daemonEventSchema = liveAgentEventSchema
```

No other change to the file.

- [ ] **Step 3: Verify nothing broke**

Run: `bun test` from the repo root.
Expected: all existing tests still pass. The `daemonEventSchema` alias keeps the existing `/api/daemon/events/route.ts` import working unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/daemon-contracts.ts
git commit -m "refactor(contracts): rename daemonEventSchema to liveAgentEventSchema

Both daemon and (soon) HTTP-poll agents will emit the same event
shape, so the name should be source-neutral. The old alias stays one
release cycle for back-compat; internal callers migrate in follow-up
commits."
```

---

## Task 2: Atomic rename of socket event + payload widen (pipeline + UI)

Rename the socket event `daemon-agent-event` → `agent-live-event` across the emitter and the single listener in one commit so the UI is never out-of-sync with the server. Add the `source: 'daemon'` discriminator to the daemon emitter's payload; widen the consumer types accordingly.

**Files:**
- Modify: `src/app/api/daemon/events/route.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/runtime-dashboard.tsx`

- [ ] **Step 1: Update the daemon route emitter**

In `src/app/api/daemon/events/route.ts`:

Change the import (line 6):

```typescript
// Before:
import { daemonEventSchema } from '@/lib/server/daemon-contracts'

// After:
import { liveAgentEventSchema } from '@/lib/server/daemon-contracts'
```

Change the `safeParse` call (line 25):

```typescript
// Before:
const parsed = daemonEventSchema.safeParse(event)

// After:
const parsed = liveAgentEventSchema.safeParse(event)
```

Change the broadcast call (lines 41-47):

```typescript
// Before:
broadcastProjectEvent(task.projectId, 'daemon-agent-event', {
  taskId,
  stepId,
  daemonId: daemon.id,
  event: parsed.data,
  timestamp: new Date().toISOString(),
})

// After:
broadcastProjectEvent(task.projectId, 'agent-live-event', {
  source: 'daemon' as const,
  daemonId: daemon.id,
  taskId,
  stepId,
  event: parsed.data,
  timestamp: new Date().toISOString(),
})
```

- [ ] **Step 2: Update the page.tsx state + listener**

In `src/app/page.tsx`:

**a. Widen the inline state type at line 240.** Replace:

```typescript
const [daemonLogs, setDaemonLogs] = useState<Array<{ taskId: string; stepId?: string; daemonId: string; event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }; timestamp: string }>>([])
```

with:

```typescript
const [liveAgentLogs, setLiveAgentLogs] = useState<Array<{ source: 'daemon' | 'http'; taskId: string; stepId?: string; daemonId?: string; agentId?: string; event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }; timestamp: string }>>([])
```

**b. Update the socket listener** around line 362. Replace:

```typescript
activeSocket.on('daemon-agent-event', (data: unknown) => {
  const entry = data as typeof daemonLogs[number]
  setDaemonLogs(prev => [...prev, entry].slice(-500))
})
```

with:

```typescript
activeSocket.on('agent-live-event', (data: unknown) => {
  const entry = data as typeof liveAgentLogs[number]
  setLiveAgentLogs(prev => [...prev, entry].slice(-500))
})
```

**c. Update the prop handoff** around line 1907. Replace:

```typescript
<RuntimeDashboard daemonLogs={daemonLogs} />
```

with:

```typescript
<RuntimeDashboard liveAgentLogs={liveAgentLogs} />
```

Grep the file for any other `daemonLogs` / `setDaemonLogs` references and rename them too (`grep -n "daemonLogs\|setDaemonLogs" src/app/page.tsx` — should show only the four lines above; if more, rename them all).

- [ ] **Step 3: Update runtime-dashboard**

In `src/components/runtime-dashboard.tsx`:

**a. Rename the local type at lines 30-36.** Replace:

```typescript
interface DaemonLogEntry {
  taskId: string
  stepId?: string
  daemonId: string
  event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }
  timestamp: string
}
```

with:

```typescript
interface LiveAgentLogEntry {
  source: 'daemon' | 'http'
  taskId: string
  stepId?: string
  daemonId?: string
  agentId?: string
  event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }
  timestamp: string
}
```

**b. Rename the prop at lines 51, 54.** Replace:

```typescript
interface RuntimeDashboardProps {
  daemonLogs: DaemonLogEntry[]
}

export function RuntimeDashboard({ daemonLogs }: RuntimeDashboardProps) {
```

with:

```typescript
interface RuntimeDashboardProps {
  liveAgentLogs: LiveAgentLogEntry[]
}

export function RuntimeDashboard({ liveAgentLogs }: RuntimeDashboardProps) {
```

**c. Update the filter at line 209.** Replace:

```typescript
entries={daemonLogs.filter((l) => l.daemonId === daemon.id)}
```

with:

```typescript
entries={liveAgentLogs.filter((l) => l.daemonId === daemon.id)}
```

The `l.daemonId === daemon.id` comparison stays — HTTP-source entries have `daemonId: undefined`, so they're naturally excluded from the daemon-scoped view (HTTP agents don't own daemons).

- [ ] **Step 4: Run tests**

Run: `bun test`

Expected: all tests pass (111+). The daemon-events test at `src/lib/server/__tests__/daemon-events-route.test.ts` doesn't assert the specific event name or payload shape — only that broadcast is *not* called in the 403 case — so the rename doesn't break it.

- [ ] **Step 5: Type-check note**

WSL local `tsc` can't validate Next's route validator types. Skip local type-check; the controller will ask the user to run `bun run type-check` from Windows before the merge.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/daemon/events/route.ts \
        src/app/page.tsx \
        src/components/runtime-dashboard.tsx
git commit -m "refactor(realtime): rename socket event daemon-agent-event to agent-live-event

One atomic rename of emitter + listener + types so no intermediate
commit has a pipeline/UI mismatch. Payload gains source: 'daemon' |
'http' discriminator; daemonId becomes optional on the consumer side
to make room for HTTP-sourced events in the next commit.

Runtime Dashboard filter (l.daemonId === daemon.id) is unchanged —
HTTP-source events have daemonId: undefined, so they're naturally
excluded from daemon-scoped views."
```

---

## Task 3: Create POST /api/agent/events + tests

TDD: write the 7 spec-mandated tests first, confirm they fail for the right reasons, then implement the route.

**Files:**
- Create: `src/app/api/agent/events/route.ts`
- Create: `src/lib/server/__tests__/agent-events-route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/server/__tests__/agent-events-route.test.ts`:

```typescript
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/agent/events/route.ts
//
// POST /api/agent/events — agent-Bearer-authenticated endpoint that mirrors
// /api/daemon/events. HTTP-poll agents use this to emit live activity events
// (thinking, tool_call, tool_result, text, completed, error) so the Kanban-
// side UI can surface them alongside daemon-sourced events.
//
// Covers: missing/invalid auth, cross-project isolation (agent can only emit
// on tasks in its own project), schema validation, stepId belongs to task,
// and the success-path broadcast payload shape.
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskStepFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    task: { findUnique: mockTaskFindUnique },
    taskStep: { findUnique: mockTaskStepFindUnique },
  },
}))

const mockResolveAgentByApiKey = mock(() => Promise.resolve(null)) as any
const mockExtractAgentApiKey = mock(() => 'fake-agent-key') as any

mock.module('@/lib/server/api-keys', () => ({
  extractAgentApiKey: mockExtractAgentApiKey,
  resolveAgentByApiKey: mockResolveAgentByApiKey,
}))

const mockBroadcastProjectEvent = mock(() => undefined) as any

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcastProjectEvent,
}))

// Import AFTER all mocks are in place
import { POST } from '@/app/api/agent/events/route'

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskStepFindUnique.mockReset()
  mockResolveAgentByApiKey.mockReset()
  mockExtractAgentApiKey.mockReset()
  mockBroadcastProjectEvent.mockReset()

  mockExtractAgentApiKey.mockReturnValue('fake-agent-key')
  mockTaskFindUnique.mockResolvedValue(null)
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockResolveAgentByApiKey.mockResolvedValue(null)
})

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/agent/events', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer fake-agent-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agent/events', () => {
  test('returns 401 when API key is missing', async () => {
    mockExtractAgentApiKey.mockReturnValueOnce(null)

    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(401)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 401 when API key does not resolve to an agent', async () => {
    // resolveAgentByApiKey returns null from beforeEach default.
    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(401)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 400 when event shape is invalid', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })

    const req = makeRequest({ taskId: 't1', event: { type: 'bogus' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(400)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 404 when taskId does not exist', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    // mockTaskFindUnique resolves null from beforeEach default.

    const req = makeRequest({ taskId: 'nope', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(404)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 403 when task belongs to a different project than the agent', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-A' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-B' })

    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(403)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 404 when stepId is provided but does not belong to the task', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })
    mockTaskStepFindUnique.mockResolvedValue(null)

    const req = makeRequest({
      taskId: 't1',
      stepId: 'ghost-step',
      event: { type: 'thinking' },
    })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(404)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('broadcasts agent-live-event with correct payload on success', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })
    mockTaskStepFindUnique.mockResolvedValue({ id: 's1', taskId: 't1' })

    const req = makeRequest({
      taskId: 't1',
      stepId: 's1',
      event: { type: 'tool_call', name: 'read_file', args: { path: 'x' } },
    })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(200)
    expect(mockBroadcastProjectEvent).toHaveBeenCalledTimes(1)

    const [projectId, eventName, payload] = mockBroadcastProjectEvent.mock.calls[0]
    expect(projectId).toBe('proj-1')
    expect(eventName).toBe('agent-live-event')
    expect(payload).toMatchObject({
      source: 'http',
      agentId: 'agent-1',
      taskId: 't1',
      stepId: 's1',
      event: { type: 'tool_call', name: 'read_file', args: { path: 'x' } },
    })
    expect(typeof payload.timestamp).toBe('string')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail correctly**

Run: `bun test src/lib/server/__tests__/agent-events-route.test.ts`
Expected: all 7 tests FAIL with a module-resolution error (`Cannot find module '@/app/api/agent/events/route'`).

- [ ] **Step 3: Create the route**

Create `src/app/api/agent/events/route.ts`:

```typescript
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { liveAgentEventSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export const POST = withErrorHandling('api/agent/events', async (request: Request) => {
  const apiKey = extractAgentApiKey(request)
  if (!apiKey) throw unauthorized('Missing agent API key')

  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) throw unauthorized('Invalid API key')

  const body = await request.json()
  const { taskId, stepId, event } = body as {
    taskId?: string
    stepId?: string
    event?: unknown
  }

  if (!taskId || !event) throw badRequest('taskId and event are required')

  const parsed = liveAgentEventSchema.safeParse(event)
  if (!parsed.success) throw badRequest('Invalid event shape')

  // Scope: the agent can only emit on tasks in its own project. Without this
  // check an agent in project A could spoof events for tasks in project B by
  // guessing a task ID — the broadcast would reach project-B subscribers.
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  })

  if (!task) throw notFound('Task not found')
  if (task.projectId !== agent.projectId) {
    throw forbidden('Task does not belong to this agent\'s project')
  }

  // If a stepId is provided, verify it belongs to this task. Prevents spoofing
  // events that claim to be from a different step (which would mislabel the
  // live feed even though the project scope is correct).
  if (stepId) {
    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })
    if (!step || step.taskId !== taskId) {
      throw notFound('Step not found on this task')
    }
  }

  broadcastProjectEvent(task.projectId, 'agent-live-event', {
    source: 'http' as const,
    agentId: agent.id,
    taskId,
    stepId,
    event: parsed.data,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/server/__tests__/agent-events-route.test.ts`
Expected: all 7 tests pass.

Then run the full suite to confirm no regression:

Run: `bun test`
Expected: full suite green (114+).

- [ ] **Step 5: Commit**

```bash
git add 'src/app/api/agent/events/route.ts' \
        src/lib/server/__tests__/agent-events-route.test.ts
git commit -m "feat(agent-events): POST /api/agent/events for HTTP-poll live events

Agent-Bearer-authenticated mirror of /api/daemon/events so HTTP-poll
agents can emit the same thinking/tool_call/tool_result/text/completed
/error events that daemon agents do. Payload carries source: 'http'
and agentId so downstream consumers can distinguish the source.

Scope enforcement: task.projectId === agent.projectId (agents are
project-scoped, tighter than the daemon's workspace scope). stepId,
when provided, must belong to the task."
```

---

## Self-Review Checklist (run before handoff)

- [ ] **Spec coverage:**
  - Schema rename + alias: Task 1.
  - Socket event rename: Task 2.
  - Payload `source` discriminator: Task 2 (daemon) + Task 3 (HTTP).
  - `POST /api/agent/events`: Task 3.
  - All 7 spec-mandated tests: Task 3 Step 1.
  - No UI component renames / no retention / no rate limit: scope discipline held.

- [ ] **Placeholder scan:** No TBD / TODO / "similar to" / "handle edge cases". All code is literal.

- [ ] **Type consistency:**
  - `liveAgentEventSchema` (Tasks 1, 2, 3) — always spelled the same.
  - Socket event string `'agent-live-event'` (Tasks 2, 3) — same literal.
  - Payload field names (`source`, `agentId`, `daemonId`, `taskId`, `stepId`, `event`, `timestamp`) match between daemon and HTTP emitters and the client type.
  - `LiveAgentLogEntry` (Task 2 step 3) and the inline state type (Task 2 step 2) have the same fields.

- [ ] **Scope discipline:**
  - No rate limiting / retention / UI changes / `DaemonLogViewer` rename.
  - No `personality` / `AgentBadge` / other prior-feature touches.
  - Each task commits only the files listed in its header.
  - No `git add -A` anywhere.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-http-agent-live-events.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
