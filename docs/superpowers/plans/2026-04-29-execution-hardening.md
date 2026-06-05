# Execution Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task execution pipeline durable: add idempotency keys to prevent double-dispatch, an append-only event log for audit and debugging, a dead-letter table for exhausted tasks, and exponential backoff with jitter instead of a fixed retry delay.

**Architecture:** Three additive schema changes (idempotency key on `TaskStep`, new `StepEvent` event log table, new `DeadLetterStep` table) applied via `db push`. Dispatch logic in `src/lib/server/dispatch.ts` and `src/lib/server/step-queue.ts` is updated to write event log entries, compute backoff delay, and move exhausted steps to dead-letter. Existing `attempts`, `maxRetries`, and `leasedAt`/`leasedBy` columns are already present and are reused.

**Tech Stack:** Prisma 7, SQLite, TypeScript 5, Bun 1.3.4

> **Implemented 2026-06-05.** Deviations from the plan as written:
> - No `idempotencyKey` column on `TaskStep` — the existing `@@unique([stepId, attempt])` constraint on `StepExecution` already is the idempotency key. `dispatchStep` now treats a P2002 collision on `createExecution` as "another worker won this attempt" and aborts gracefully instead of erroring.
> - The retry/failure path lives in `dispatch.ts`, not `step-queue.ts` as the File Map guessed; all wiring went there. `leasedAt` keeps doubling as the "not before" time for retries, now set via backoff instead of the fixed delay.
> - `computeBackoffMs` uses equal jitter (`exp + rand(exp)`, floor at the deterministic component) rather than the plan's full jitter — the plan's own test bounds (`attempt 1 >= baseMs`) are only guaranteed with a floor.
> - `appendStepEvent` never throws (logged + swallowed): the audit log must not break dispatch.
> - Events emitted: `leased` (with eviction info), `started` (with executionId), `succeeded`, `failed` (every failed attempt), `retry_scheduled` (with delayMs/retryAt), `dead_lettered`. Dead-letter still respects the fallback-agent cycle first.
> - The executions API keeps its bare-array shape for existing consumers; `?include=events` returns `{ executions, events }`.

---

## File Map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `idempotencyKey` to `TaskStep`; add `StepEvent` and `DeadLetterStep` models |
| `src/lib/server/dispatch.ts` | Write `step.started` event on lease; compute exponential backoff on failure |
| `src/lib/server/step-queue.ts` | Write events on success/failure; move exhausted steps to dead-letter |
| `src/lib/server/step-events.ts` | New — `appendStepEvent()` helper |
| `src/app/api/tasks/[id]/steps/[stepId]/executions/route.ts` | Include step events in execution history response |
| `src/lib/server/__tests__/execution-hardening.test.ts` | New — tests for backoff, dead-letter, idempotency |

---

### Task 1: Schema — add idempotency key and event log

**Files:**
- Modify: `prisma/schema.prisma`

- [x] **Step 1: Add `idempotencyKey` to `TaskStep`**

In `prisma/schema.prisma`, inside the `TaskStep` model, add after the `fallbackAgentId` field:

```prisma
idempotencyKey String? @unique
```

- [x] **Step 2: Add `StepEvent` model**

After the `StepReview` model, add:

```prisma
model StepEvent {
  id        String   @id @default(cuid())
  stepId    String
  step      TaskStep @relation(fields: [stepId], references: [id], onDelete: Cascade)
  event     String   // leased | started | succeeded | failed | dead_lettered | retry_scheduled
  data      String?  // JSON — error message, adapter info, next_retry_at, etc.
  createdAt DateTime @default(now())

  @@index([stepId])
  @@index([stepId, event])
}
```

Also add the relation to `TaskStep`:

```prisma
// Inside TaskStep model, after the existing relations:
stepEvents StepEvent[]
```

- [x] **Step 3: Add `DeadLetterStep` model**

After `StepEvent`, add:

```prisma
model DeadLetterStep {
  id             String   @id @default(cuid())
  originalStepId String
  taskId         String
  agentId        String?
  mode           String
  instructions   String?
  attempts       Int
  lastError      String?
  lastErrorAt    DateTime?
  payload        String?  // JSON snapshot of step at time of failure
  movedAt        DateTime @default(now())

  @@index([taskId])
}
```

- [x] **Step 4: Push schema changes**

```bash
bun run db:push
```

Expected output: `Your database is now in sync with your Prisma schema.`

- [x] **Step 5: Regenerate client**

```bash
bun run db:generate
```

- [x] **Step 6: Verify no type errors from schema changes**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
```

Expected: no new errors.

- [x] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma/
git commit -m "feat(schema): add idempotency key, step event log, and dead-letter table"
```

---

### Task 2: Step event helper

**Files:**
- Create: `src/lib/server/step-events.ts`

- [x] **Step 1: Write the failing test first**

Create `src/lib/server/__tests__/execution-hardening.test.ts`:

```typescript
import { describe, test, expect, mock } from 'bun:test'

const mockCreate = mock(() => Promise.resolve({ id: 'evt-1' }))

mock.module('@/lib/db', () => ({
  db: {
    stepEvent: { create: mockCreate },
  },
}))

import { appendStepEvent } from '../step-events'

describe('appendStepEvent', () => {
  test('creates a step event with the correct shape', async () => {
    await appendStepEvent('step-1', 'leased', { worker: 'w1' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const call = mockCreate.mock.calls[0][0]
    expect(call.data.stepId).toBe('step-1')
    expect(call.data.event).toBe('leased')
    expect(JSON.parse(call.data.data)).toEqual({ worker: 'w1' })
  })

  test('accepts null data', async () => {
    mockCreate.mockReset()
    mockCreate.mockResolvedValue({ id: 'evt-2' })
    await appendStepEvent('step-2', 'succeeded', null)
    const call = mockCreate.mock.calls[0][0]
    expect(call.data.data).toBeNull()
  })
})
```

- [x] **Step 2: Run the test to confirm it fails**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts
```

Expected: FAIL — `appendStepEvent` not found.

- [x] **Step 3: Write `src/lib/server/step-events.ts`**

```typescript
import { db } from '@/lib/db'

export type StepEventType =
  | 'leased'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'dead_lettered'
  | 'retry_scheduled'

export async function appendStepEvent(
  stepId: string,
  event: StepEventType,
  data: Record<string, unknown> | null,
): Promise<void> {
  await db.stepEvent.create({
    data: {
      stepId,
      event,
      data: data !== null ? JSON.stringify(data) : null,
    },
  })
}
```

- [x] **Step 4: Run the test to confirm it passes**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts
```

Expected: 2 pass, 0 fail.

- [x] **Step 5: Commit**

```bash
git add src/lib/server/step-events.ts src/lib/server/__tests__/execution-hardening.test.ts
git commit -m "feat: add appendStepEvent helper for append-only step event log"
```

---

### Task 3: Exponential backoff on retry

**Files:**
- Modify: `src/lib/server/step-queue.ts` (or wherever `retryDelayMs` is applied on failure)

Currently `retryDelayMs` is a fixed value. Replace with an exponential formula capped at 1 hour.

- [x] **Step 1: Add a backoff test**

In `src/lib/server/__tests__/execution-hardening.test.ts`, add:

```typescript
import { computeBackoffMs } from '../step-events'

describe('computeBackoffMs', () => {
  test('attempt 1 returns baseMs', () => {
    const ms = computeBackoffMs(1, 5000)
    expect(ms).toBeGreaterThanOrEqual(5000)
    expect(ms).toBeLessThan(10000 + 5000) // base * 2^1 + jitter ceiling
  })

  test('caps at 3600000ms (1 hour)', () => {
    const ms = computeBackoffMs(20, 5000)
    expect(ms).toBeLessThanOrEqual(3_600_000)
  })

  test('each attempt produces a higher expected value than the previous', () => {
    // Run 20 samples per attempt level; median should be higher for attempt 3 vs 1
    const median = (attempt: number) =>
      Array.from({ length: 20 }, () => computeBackoffMs(attempt, 5000)).sort((a, b) => a - b)[10]
    expect(median(3)).toBeGreaterThan(median(1))
  })
})
```

- [x] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts
```

Expected: FAIL — `computeBackoffMs` not exported.

- [x] **Step 3: Add `computeBackoffMs` to `src/lib/server/step-events.ts`**

```typescript
/**
 * Exponential backoff with full jitter.
 * attempt: 1-based retry count
 * baseMs: the configured retryDelayMs for the step
 */
export function computeBackoffMs(attempt: number, baseMs: number): number {
  const cappedAttempt = Math.min(attempt, 10)
  const ceiling = Math.min(baseMs * Math.pow(2, cappedAttempt), 3_600_000)
  return Math.floor(Math.random() * ceiling)
}
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts
```

Expected: all tests pass.

- [x] **Step 5: Wire backoff into the step failure path**

In `src/lib/server/step-queue.ts` (or `dispatch.ts`), find where `retryDelayMs` is used to schedule the next retry. Replace the fixed delay with `computeBackoffMs`:

```typescript
import { computeBackoffMs, appendStepEvent } from '@/lib/server/step-events'

// Where a step fails and has retries remaining:
const delayMs = computeBackoffMs(step.attempts, step.retryDelayMs)
const retryAt = new Date(Date.now() + delayMs)

await db.taskStep.update({
  where: { id: step.id },
  data: { status: 'pending', leasedBy: null, leasedAt: null },
})

await appendStepEvent(step.id, 'retry_scheduled', {
  attempt: step.attempts,
  delayMs,
  retryAt: retryAt.toISOString(),
  error: errorMessage,
})
```

- [x] **Step 6: Type-check and full test run**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/lib/server/step-events.ts src/lib/server/step-queue.ts src/lib/server/__tests__/execution-hardening.test.ts
git commit -m "feat: replace fixed retry delay with exponential backoff in step failure path"
```

---

### Task 4: Dead-letter on exhausted retries

**Files:**
- Modify: `src/lib/server/step-queue.ts`

When `step.attempts >= step.maxRetries`, move the step to `DeadLetterStep` instead of scheduling another retry.

- [x] **Step 1: Add a dead-letter test**

In `src/lib/server/__tests__/execution-hardening.test.ts`, add:

```typescript
const mockDeadLetterCreate = mock(() => Promise.resolve({ id: 'dl-1' }))
const mockStepUpdate = mock(() => Promise.resolve({}))

mock.module('@/lib/db', () => ({
  db: {
    stepEvent: { create: mockCreate },
    deadLetterStep: { create: mockDeadLetterCreate },
    taskStep: { update: mockStepUpdate },
  },
}))

import { moveToDeadLetter } from '../step-events'

describe('moveToDeadLetter', () => {
  test('creates a dead letter entry and appends a dead_lettered event', async () => {
    await moveToDeadLetter({
      id: 'step-1', taskId: 'task-1', agentId: 'agent-1',
      mode: 'code', instructions: 'do x', attempts: 5,
    }, 'Timeout after 5 attempts')

    expect(mockDeadLetterCreate).toHaveBeenCalledTimes(1)
    const dlCall = mockDeadLetterCreate.mock.calls[0][0]
    expect(dlCall.data.originalStepId).toBe('step-1')
    expect(dlCall.data.attempts).toBe(5)
    expect(dlCall.data.lastError).toBe('Timeout after 5 attempts')
  })
})
```

- [x] **Step 2: Run to confirm failure**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts 2>&1 | grep "moveToDeadLetter"
```

Expected: FAIL — `moveToDeadLetter` not found.

- [x] **Step 3: Add `moveToDeadLetter` to `src/lib/server/step-events.ts`**

```typescript
interface StepSnapshot {
  id: string
  taskId: string
  agentId?: string | null
  mode: string
  instructions?: string | null
  attempts: number
}

export async function moveToDeadLetter(step: StepSnapshot, lastError: string): Promise<void> {
  await db.deadLetterStep.create({
    data: {
      originalStepId: step.id,
      taskId: step.taskId,
      agentId: step.agentId ?? null,
      mode: step.mode,
      instructions: step.instructions ?? null,
      attempts: step.attempts,
      lastError,
      lastErrorAt: new Date(),
      payload: JSON.stringify(step),
    },
  })

  await appendStepEvent(step.id, 'dead_lettered', { reason: lastError })
}
```

- [x] **Step 4: Run tests**

```bash
bun test src/lib/server/__tests__/execution-hardening.test.ts
```

Expected: all tests pass.

- [x] **Step 5: Wire `moveToDeadLetter` into the failure path**

In `src/lib/server/step-queue.ts`, in the step failure handler, replace the current "retry or give up" logic:

```typescript
import { computeBackoffMs, appendStepEvent, moveToDeadLetter } from '@/lib/server/step-events'

if (step.attempts >= step.maxRetries) {
  await moveToDeadLetter(step, errorMessage)
  await db.taskStep.update({
    where: { id: step.id },
    data: { status: 'failed', error: errorMessage },
  })
} else {
  const delayMs = computeBackoffMs(step.attempts, step.retryDelayMs)
  await db.taskStep.update({
    where: { id: step.id },
    data: { status: 'pending', leasedBy: null, leasedAt: null },
  })
  await appendStepEvent(step.id, 'retry_scheduled', {
    attempt: step.attempts,
    delayMs,
    error: errorMessage,
  })
}
```

- [x] **Step 6: Type-check and full test run**

```bash
bun run type-check 2>&1 | grep -v "help-page\|trigger-evaluator"
bun test
```

Expected: no new errors, all tests pass.

- [x] **Step 7: Commit**

```bash
git add src/lib/server/step-events.ts src/lib/server/step-queue.ts src/lib/server/__tests__/execution-hardening.test.ts
git commit -m "feat: move exhausted steps to dead-letter table instead of failing silently"
```
