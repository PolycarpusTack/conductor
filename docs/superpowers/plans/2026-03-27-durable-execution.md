# Durable Execution & Retry Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make step execution queue-backed, resumable, idempotent, and auditable — with retry policies, timeout control, dead-letter handling, and a clear execution history per step.

**Architecture:** Add a `StepExecution` model to track every attempt. Replace fire-and-forget `dispatchStep` with a DB-backed job queue that leases steps, enforces timeouts, and respects retry policies. The queue is polled by a background worker (Next.js API route + setInterval), not an external service — keeping the SQLite single-process model.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, TypeScript

**Current state:** `dispatchStep()` is fire-and-forget. If it crashes mid-execution, the step is stuck in `active` forever. No retry policies exist. No execution history — the `output` field is overwritten on each attempt. The `attempts` counter exists but only increments on human rejection, not on automated retries.

---

## Task 1: Add StepExecution model and retry policy fields

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add StepExecution model to schema**

Add after the `TaskStep` model in `prisma/schema.prisma`:

```prisma
model StepExecution {
  id            String    @id @default(cuid())
  stepId        String
  step          TaskStep  @relation(fields: [stepId], references: [id], onDelete: Cascade)
  attempt       Int
  status        String    @default("running")  // running, succeeded, failed, timed_out
  output        String?
  error         String?
  tokensUsed    Int?
  cost          Float?
  durationMs    Int?
  startedAt     DateTime  @default(now())
  completedAt   DateTime?
  createdAt     DateTime  @default(now())

  @@unique([stepId, attempt])
}
```

- [ ] **Step 2: Add retry policy fields to TaskStep**

Add to the `TaskStep` model:

```prisma
  maxRetries     Int       @default(2)
  retryDelayMs   Int       @default(5000)
  timeoutMs      Int       @default(300000)  // 5 minutes
  leasedAt       DateTime?
  leasedBy       String?   // worker ID for idempotent leasing
```

Add the relation to TaskStep:

```prisma
  executions    StepExecution[]
```

- [ ] **Step 3: Add `google` to the adapter enum in contracts**

In `src/lib/server/contracts.ts`, update the `createProjectRuntimeSchema` adapter enum:

```typescript
  adapter: z.enum(['anthropic', 'openai', 'google', 'z-ai', 'github-copilot', 'webhook']),
```

- [ ] **Step 4: Add retry policy to taskStepSchema**

In `src/lib/server/contracts.ts`, add to `taskStepSchema`:

```typescript
export const taskStepSchema = z.object({
  agentId: z.string().trim().min(1).optional().nullable(),
  humanLabel: z.string().trim().max(120).optional(),
  mode: z.string().trim().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(300000).optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
})
```

- [ ] **Step 5: Push schema and regenerate**

```bash
bun run db:push --accept-data-loss && bun run db:generate
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/server/contracts.ts src/generated/
git commit -m "feat: add StepExecution model and retry policy fields to TaskStep"
```

---

## Task 2: Create execution logger

**Files:**
- Create: `src/lib/server/execution-log.ts`

This module creates, updates, and queries StepExecution records.

- [ ] **Step 1: Create execution-log.ts**

```typescript
import { db } from '@/lib/db'

export async function createExecution(stepId: string, attempt: number) {
  return db.stepExecution.create({
    data: {
      stepId,
      attempt,
      status: 'running',
      startedAt: new Date(),
    },
  })
}

export async function succeedExecution(
  executionId: string,
  output: string,
  tokensUsed?: number,
  cost?: number,
) {
  const execution = await db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'succeeded',
      output,
      tokensUsed,
      cost,
      completedAt: new Date(),
    },
  })

  // Compute duration
  const durationMs = execution.completedAt && execution.startedAt
    ? execution.completedAt.getTime() - execution.startedAt.getTime()
    : null

  if (durationMs !== null) {
    await db.stepExecution.update({
      where: { id: executionId },
      data: { durationMs },
    })
  }

  return execution
}

export async function failExecution(executionId: string, error: string) {
  const execution = await db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'failed',
      error,
      completedAt: new Date(),
    },
  })

  const durationMs = execution.completedAt && execution.startedAt
    ? execution.completedAt.getTime() - execution.startedAt.getTime()
    : null

  if (durationMs !== null) {
    await db.stepExecution.update({
      where: { id: executionId },
      data: { durationMs },
    })
  }

  return execution
}

export async function timeoutExecution(executionId: string) {
  return db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'timed_out',
      error: 'Step execution timed out',
      completedAt: new Date(),
    },
  })
}

export async function getExecutionHistory(stepId: string) {
  return db.stepExecution.findMany({
    where: { stepId },
    orderBy: { attempt: 'asc' },
  })
}

export async function getLatestExecution(stepId: string) {
  return db.stepExecution.findFirst({
    where: { stepId },
    orderBy: { attempt: 'desc' },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/execution-log.ts
git commit -m "feat: add execution logger for step attempt tracking"
```

---

## Task 3: Rewrite dispatchStep to use execution log and respect retry policies

**Files:**
- Modify: `src/lib/server/dispatch.ts`

This is the core change. `dispatchStep` becomes:
1. Lease the step (idempotent — check `leasedBy`)
2. Create a StepExecution record
3. Set up a timeout race
4. Execute the adapter
5. On success: mark execution succeeded, mark step done, advance chain
6. On failure: mark execution failed, check retry policy, either re-queue or fail step
7. On timeout: mark execution timed out, same retry check

- [ ] **Step 1: Add worker ID generation at module level**

At the top of `dispatch.ts`, add:

```typescript
import { createExecution, succeedExecution, failExecution, timeoutExecution } from '@/lib/server/execution-log'
import { randomBytes } from 'crypto'

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`
```

- [ ] **Step 2: Add leaseStep helper**

Add before `dispatchStep`:

```typescript
async function leaseStep(stepId: string): Promise<boolean> {
  const result = await db.taskStep.updateMany({
    where: {
      id: stepId,
      status: 'active',
      OR: [
        { leasedBy: null },
        { leasedBy: WORKER_ID },
      ],
    },
    data: {
      leasedBy: WORKER_ID,
      leasedAt: new Date(),
    },
  })
  return result.count > 0
}

async function releaseStep(stepId: string) {
  await db.taskStep.update({
    where: { id: stepId },
    data: { leasedBy: null, leasedAt: null },
  })
}
```

- [ ] **Step 3: Add retry scheduling helper**

```typescript
async function scheduleRetry(stepId: string, delayMs: number) {
  // Release the lease so the step can be picked up again
  await db.taskStep.update({
    where: { id: stepId },
    data: {
      leasedBy: null,
      leasedAt: null,
      // Keep status 'active' so the queue picks it up
    },
  })

  // If delay is 0, the next poll cycle will pick it up
  // For non-zero delays, we set leasedAt to a future time as a "not before" marker
  if (delayMs > 0) {
    await db.taskStep.update({
      where: { id: stepId },
      data: { leasedAt: new Date(Date.now() + delayMs) },
    })
  }
}
```

- [ ] **Step 4: Rewrite the try/catch block in dispatchStep**

Replace the existing try/catch block (from `try {` through the end of `catch`) with:

```typescript
  // Lease the step for idempotent execution
  const leased = await leaseStep(stepId)
  if (!leased) return // another worker has it

  // Determine attempt number
  const previousExecutions = await db.stepExecution.count({ where: { stepId } })
  const attemptNumber = previousExecutions + 1

  const execution = await createExecution(stepId, attemptNumber)

  // Update step's startedAt on first attempt
  if (attemptNumber === 1) {
    await db.taskStep.updateMany({
      where: { id: stepId, status: 'active' },
      data: { startedAt: new Date() },
    })
  }

  const timeoutMs = step.timeoutMs || 300000 // default 5 min

  try {
    // Race the adapter against a timeout
    const result = await Promise.race([
      adapter.dispatch({
        systemPrompt,
        taskContext: fullTaskContext,
        previousOutput: previousStep?.output || undefined,
        mode: step.mode,
        model: agent.runtimeModel || 'default',
        runtimeConfig,
        tools: tools.length > 0 ? tools : undefined,
        mcpConnectionIds: mcpConnectionIds.length > 0 ? mcpConnectionIds : undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('STEP_TIMEOUT')), timeoutMs)
      ),
    ])

    // Success path
    await succeedExecution(execution.id, result.output, result.tokensUsed)

    await db.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'done',
        output: result.output,
        attempts: attemptNumber,
        completedAt: new Date(),
        leasedBy: null,
        leasedAt: null,
      },
    })

    await broadcastProjectEvent(step.task.projectId, 'step-completed', {
      taskId: step.taskId,
      stepId,
      output: result.output,
      attempt: attemptNumber,
      tokensUsed: result.tokensUsed,
    })

    await advanceChain(step.taskId, step.task.projectId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error'
    const isTimeout = message === 'STEP_TIMEOUT'

    if (isTimeout) {
      await timeoutExecution(execution.id)
    } else {
      await failExecution(execution.id, message)
    }

    const maxRetries = step.maxRetries ?? 2
    const retryDelayMs = step.retryDelayMs ?? 5000

    if (attemptNumber < maxRetries + 1) {
      // Retry: keep step active, schedule for re-pickup
      await db.taskStep.update({
        where: { id: stepId },
        data: { attempts: attemptNumber },
      })

      await broadcastProjectEvent(step.task.projectId, 'step-retrying', {
        taskId: step.taskId,
        stepId,
        attempt: attemptNumber,
        maxRetries,
        error: message,
      })

      await scheduleRetry(stepId, retryDelayMs)
    } else {
      // Exhausted retries — dead-letter: fail the step
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          status: 'failed',
          error: `Failed after ${attemptNumber} attempts. Last error: ${message}`,
          attempts: attemptNumber,
          completedAt: new Date(),
          leasedBy: null,
          leasedAt: null,
        },
      })

      await broadcastProjectEvent(step.task.projectId, 'step-failed', {
        taskId: step.taskId,
        stepId,
        error: message,
        attempt: attemptNumber,
        exhaustedRetries: true,
      })

      await db.task.update({
        where: { id: step.taskId },
        data: { status: 'WAITING' },
      })
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/dispatch.ts
git commit -m "feat: durable step execution with leasing, retries, timeouts, and execution log"
```

---

## Task 4: Create step execution queue (background poller)

**Files:**
- Create: `src/lib/server/step-queue.ts`
- Create: `src/app/api/internal/poll-steps/route.ts`

The queue polls for steps that are `active`, not leased (or lease expired), and past any retry delay. This replaces the fire-and-forget `dispatchStep(id).catch(console.error)` pattern.

- [ ] **Step 1: Create step-queue.ts**

```typescript
import { db } from '@/lib/db'
import { dispatchStep } from '@/lib/server/dispatch'

const LEASE_TIMEOUT_MS = 600000 // 10 min — if a worker hasn't finished, assume it died
const POLL_BATCH_SIZE = 5

export async function pollAndDispatch() {
  const now = new Date()
  const leaseExpiry = new Date(now.getTime() - LEASE_TIMEOUT_MS)

  // Find steps that are active and either:
  // 1. Not leased (leasedBy is null) and not delayed (leasedAt is null or in the past)
  // 2. Lease expired (leasedAt < expiry threshold)
  const steps = await db.taskStep.findMany({
    where: {
      status: 'active',
      agent: { runtimeId: { not: null } },
      mode: { not: 'human' },
      OR: [
        {
          leasedBy: null,
          OR: [
            { leasedAt: null },
            { leasedAt: { lte: now } }, // retry delay has passed
          ],
        },
        {
          leasedAt: { lt: leaseExpiry }, // stale lease — worker died
        },
      ],
    },
    select: { id: true },
    take: POLL_BATCH_SIZE,
    orderBy: { createdAt: 'asc' }, // FIFO
  })

  // Dispatch each step (dispatchStep handles its own leasing)
  const results = await Promise.allSettled(
    steps.map(step => dispatchStep(step.id))
  )

  return {
    polled: steps.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}
```

- [ ] **Step 2: Create internal poll API route**

Create `src/app/api/internal/poll-steps/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { pollAndDispatch } from '@/lib/server/step-queue'

// This endpoint is called by a cron job, external scheduler, or on-startup setInterval.
// It should be protected in production (e.g., internal secret header).
export async function POST(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  if (secret !== process.env.AGENTBOARD_WS_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await pollAndDispatch()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[Queue] Poll error:', error)
    return NextResponse.json({ error: 'Poll failed' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Update callers to stop using fire-and-forget dispatch**

In `dispatch.ts`, replace all `dispatchStep(id).catch(console.error)` calls in `advanceChain`, `rewindChain`, and `startChain` with:

```typescript
// Step is already active — the queue will pick it up on next poll
```

This means: instead of calling `dispatchStep` inline, just set the step to `active` and let the poller find it. The three locations are:

1. `advanceChain` (~line 200): Remove `dispatchStep(nextStep.id).catch(console.error)`
2. `rewindChain` (~line 258): Remove the `dispatchStep(targetStepId).catch(...)` block
3. `startChain` (~line 319): Remove `dispatchStep(firstStep.id).catch(console.error)`

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/step-queue.ts src/app/api/internal/poll-steps/route.ts src/lib/server/dispatch.ts
git commit -m "feat: add DB-backed step execution queue with polling"
```

---

## Task 5: Expose execution history in API and selects

**Files:**
- Modify: `src/lib/server/selects.ts`
- Modify: `src/app/api/tasks/[id]/steps/[stepId]/route.ts`
- Create: `src/app/api/tasks/[id]/steps/[stepId]/executions/route.ts`

- [ ] **Step 1: Add executions to step detail include**

In `src/lib/server/selects.ts`, add a new export:

```typescript
export const stepDetailInclude = {
  agent: { select: { id: true, name: true, emoji: true } },
  executions: {
    select: {
      id: true,
      attempt: true,
      status: true,
      output: true,
      error: true,
      tokensUsed: true,
      cost: true,
      durationMs: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { attempt: 'asc' as const },
  },
} as const
```

- [ ] **Step 2: Create executions GET endpoint**

Create `src/app/api/tasks/[id]/steps/[stepId]/executions/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const executions = await db.stepExecution.findMany({
      where: { stepId },
      orderBy: { attempt: 'asc' },
    })

    return NextResponse.json(executions)
  } catch (error) {
    console.error('Error fetching executions:', error)
    return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/selects.ts src/app/api/tasks/[id]/steps/[stepId]/executions/route.ts
git commit -m "feat: expose step execution history via API"
```

---

## Task 6: Add retry policy UI to chain builder

**Files:**
- Modify: `src/components/chain-builder.tsx`

- [ ] **Step 1: Add retry policy fields to step editor in chain builder**

In the chain builder step editor (where mode, instructions, and autoContinue are configured), add three fields for agent (non-human) steps:

1. **Max Retries** — number input, default 2, range 0-10
2. **Retry Delay** — select with options: "Immediate" (0), "5 seconds" (5000), "30 seconds" (30000), "1 minute" (60000), "5 minutes" (300000)
3. **Timeout** — select with options: "1 minute" (60000), "5 minutes" (300000), "10 minutes" (600000)

These values are included in the step data when creating tasks.

- [ ] **Step 2: Commit**

```bash
git add src/components/chain-builder.tsx
git commit -m "feat: add retry policy controls to chain builder"
```

---

## Task 7: Add execution history viewer to step output viewer

**Files:**
- Modify: `src/components/step-output-viewer.tsx`

- [ ] **Step 1: Add execution history accordion**

In the step output viewer, for each step that has executions, add an expandable section showing:
- Attempt number and status badge (succeeded/failed/timed_out)
- Duration
- Tokens used
- Output or error text (truncated with expand)
- Timestamp

Use the `GET /api/tasks/[id]/steps/[stepId]/executions` endpoint to fetch data when expanded.

- [ ] **Step 2: Commit**

```bash
git add src/components/step-output-viewer.tsx
git commit -m "feat: show execution history in step output viewer"
```

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `schema.prisma`, `contracts.ts` | StepExecution model + retry policy fields |
| 2 | `execution-log.ts` | Create/update/query execution records |
| 3 | `dispatch.ts` | Durable dispatch with leasing, retries, timeouts |
| 4 | `step-queue.ts`, `poll-steps/route.ts`, `dispatch.ts` | DB-backed polling queue replaces fire-and-forget |
| 5 | `selects.ts`, `executions/route.ts` | Expose execution history via API |
| 6 | `chain-builder.tsx` | Retry policy UI controls |
| 7 | `step-output-viewer.tsx` | Execution history viewer |

**After this, the execution model is:**
Step becomes active → queue polls → worker leases step → creates execution record → races adapter vs timeout → on success: log, mark done, advance chain → on failure: log, check retries, re-queue or dead-letter → all attempts preserved in StepExecution
