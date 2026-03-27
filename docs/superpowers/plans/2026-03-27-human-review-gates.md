# Enhanced Human Review Gates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade human review from simple approve/reject to a full review system with attempt comparison, reassignment to another agent, required sign-off rules, and revision requests with inline feedback.

**Architecture:** Extend the existing TaskStep model with review-specific fields. Add a `StepReview` model to track individual reviewer decisions. Build a comparison view for multi-attempt steps. The existing `rewindChain` and step API are the foundation — this extends them.

**Tech Stack:** Next.js 16, Prisma 7 (SQLite), Zod 4, React 19, Tailwind 4, shadcn/ui

**Current state:** Human steps can approve (advance chain), reject with redo/close, retry failed steps, and skip. Rejection notes exist. Attempt counter exists. But: no way to compare attempts, no reassign-to-another-agent, no required sign-off count, no structured review decisions.

---

## Task 1: Add StepReview model and sign-off fields

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/server/contracts.ts`

- [ ] **Step 1: Add StepReview model**

Add after `StepExecution` in `prisma/schema.prisma`:

```prisma
model StepReview {
  id            String    @id @default(cuid())
  stepId        String
  step          TaskStep  @relation(fields: [stepId], references: [id], onDelete: Cascade)
  reviewer      String    // admin username or "admin" for now (multi-user later)
  decision      String    // approved, rejected, revision_requested
  note          String?
  createdAt     DateTime  @default(now())
}
```

- [ ] **Step 2: Add sign-off fields to TaskStep**

Add to `TaskStep`:

```prisma
  requiredSignOffs  Int       @default(1)
  reviews           StepReview[]
```

- [ ] **Step 3: Add reassign fields to rejectStepSchema**

In `contracts.ts`, the `rejectStepSchema` already has `reassignAgentId` and `reassignMode`. Add a new action schema for review decisions:

```typescript
export const stepReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'revision_requested']),
  note: z.string().max(5000).optional(),
  reviewer: z.string().max(120).default('admin'),
  // For rejected/revision_requested:
  reassignAgentId: z.string().optional(),
  reassignMode: z.string().optional(),
})
```

- [ ] **Step 4: Push schema and regenerate**

```bash
bun run db:push --accept-data-loss && bun run db:generate
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/server/contracts.ts src/generated/
git commit -m "feat: add StepReview model and sign-off fields for human review gates"
```

---

## Task 2: Implement review decision logic

**Files:**
- Create: `src/lib/server/review-logic.ts`

- [ ] **Step 1: Create review-logic.ts**

```typescript
import { db } from '@/lib/db'
import { advanceChain, rewindChain } from '@/lib/server/dispatch'
import { broadcastProjectEvent } from '@/lib/server/realtime'

interface ReviewDecision {
  stepId: string
  taskId: string
  projectId: string
  decision: 'approved' | 'rejected' | 'revision_requested'
  note?: string
  reviewer: string
  reassignAgentId?: string
  reassignMode?: string
}

export async function submitReview(input: ReviewDecision) {
  const step = await db.taskStep.findUnique({
    where: { id: input.stepId },
    include: { reviews: true },
  })

  if (!step) throw new Error('Step not found')

  // Record the review
  const review = await db.stepReview.create({
    data: {
      stepId: input.stepId,
      reviewer: input.reviewer,
      decision: input.decision,
      note: input.note || null,
    },
  })

  await broadcastProjectEvent(input.projectId, 'step-reviewed', {
    taskId: input.taskId,
    stepId: input.stepId,
    review,
  })

  if (input.decision === 'approved') {
    return handleApproval(step, input)
  } else if (input.decision === 'rejected') {
    return handleRejection(step, input)
  } else {
    return handleRevisionRequest(step, input)
  }
}

async function handleApproval(
  step: { id: string; taskId: string; requiredSignOffs: number; reviews: { decision: string }[] },
  input: ReviewDecision,
) {
  // Count total approvals including this one
  const approvalCount = step.reviews.filter(r => r.decision === 'approved').length + 1

  if (approvalCount >= step.requiredSignOffs) {
    // All sign-offs received — mark step done and advance
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'done', completedAt: new Date() },
    })
    await advanceChain(step.taskId, input.projectId)
    return { action: 'approved_and_advanced', approvalCount }
  }

  // Waiting for more sign-offs
  return {
    action: 'approved_awaiting_signoffs',
    approvalCount,
    required: step.requiredSignOffs,
  }
}

async function handleRejection(
  step: { id: string; taskId: string },
  input: ReviewDecision,
) {
  if (input.reassignAgentId) {
    // Reassign: find the target step (previous agent step) and change its agent
    const previousAgentStep = await db.taskStep.findFirst({
      where: {
        taskId: step.taskId,
        order: { lt: (await db.taskStep.findUnique({ where: { id: step.id }, select: { order: true } }))!.order },
        mode: { not: 'human' },
      },
      orderBy: { order: 'desc' },
    })

    if (previousAgentStep) {
      await db.taskStep.update({
        where: { id: previousAgentStep.id },
        data: {
          agentId: input.reassignAgentId,
          ...(input.reassignMode && { mode: input.reassignMode }),
        },
      })
    }

    // Reset current human step to pending
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'pending', output: null, completedAt: null },
    })

    // Rewind to the agent step
    if (previousAgentStep) {
      await rewindChain(step.taskId, input.projectId, previousAgentStep.id, input.note || 'Rejected and reassigned')
    }

    return { action: 'rejected_and_reassigned', reassignedTo: input.reassignAgentId }
  }

  // Standard rejection — rewind to previous agent step
  const previousAgentStep = await db.taskStep.findFirst({
    where: {
      taskId: step.taskId,
      mode: { not: 'human' },
    },
    orderBy: { order: 'desc' },
  })

  if (previousAgentStep) {
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'pending', output: null, completedAt: null },
    })
    await rewindChain(step.taskId, input.projectId, previousAgentStep.id, input.note || 'Rejected')
  }

  return { action: 'rejected_and_rewound' }
}

async function handleRevisionRequest(
  step: { id: string; taskId: string },
  input: ReviewDecision,
) {
  // Revision requested is like a soft rejection — rewind but keep the step "under review"
  const previousAgentStep = await db.taskStep.findFirst({
    where: {
      taskId: step.taskId,
      mode: { not: 'human' },
    },
    orderBy: { order: 'desc' },
  })

  if (previousAgentStep) {
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'pending', output: null, completedAt: null },
    })
    await rewindChain(
      step.taskId,
      input.projectId,
      previousAgentStep.id,
      `REVISION REQUESTED: ${input.note || 'Please revise your output'}`,
    )
  }

  return { action: 'revision_requested' }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/review-logic.ts
git commit -m "feat: implement review decision logic with sign-offs, reassignment, and revision requests"
```

---

## Task 3: Wire review decisions into step API

**Files:**
- Modify: `src/app/api/tasks/[id]/steps/[stepId]/route.ts`

- [ ] **Step 1: Add review action handler**

Import `submitReview` and `stepReviewSchema`, then add a new handler before the generic update section:

```typescript
import { submitReview } from '@/lib/server/review-logic'
import { stepReviewSchema } from '@/lib/server/contracts'

// Handle review decision
if (body.action === 'review') {
  const parsed = stepReviewSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid review payload' },
      { status: 400 },
    )
  }

  const result = await submitReview({
    stepId,
    taskId: id,
    projectId,
    decision: parsed.data.decision,
    note: parsed.data.note,
    reviewer: parsed.data.reviewer,
    reassignAgentId: parsed.data.reassignAgentId,
    reassignMode: parsed.data.reassignMode,
  })

  return NextResponse.json({ success: true, ...result })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/tasks/[id]/steps/[stepId]/route.ts
git commit -m "feat: wire review decisions into step API"
```

---

## Task 4: Build attempt comparison view

**Files:**
- Create: `src/components/attempt-comparison.tsx`

- [ ] **Step 1: Create attempt comparison component**

A side-by-side or tabbed view showing all execution attempts for a step. Each attempt shows:
- Attempt number and status badge
- Full output text (with syntax highlighting for code blocks via react-syntax-highlighter — already a dependency)
- Error message if failed
- Duration and token count
- Rejection note that triggered this attempt (from the step's rejectionNote at that time)

Props:

```typescript
interface AttemptComparisonProps {
  taskId: string
  stepId: string
  attempts: StepExecution[]
  onClose: () => void
}
```

Uses a tabbed interface: each tab is an attempt. When there are exactly 2 attempts, show a side-by-side diff-style view. For 3+, use tabs.

Fetch attempts via `GET /api/tasks/[id]/steps/[stepId]/executions`.

- [ ] **Step 2: Wire into step output viewer**

In `step-output-viewer.tsx`, add a "Compare Attempts" button on steps that have `attempts > 1`. Clicking it opens the `AttemptComparison` component.

- [ ] **Step 3: Commit**

```bash
git add src/components/attempt-comparison.tsx src/components/step-output-viewer.tsx
git commit -m "feat: add attempt comparison view for multi-attempt steps"
```

---

## Task 5: Build review action panel in task detail drawer

**Files:**
- Modify: `src/components/task-detail-drawer.tsx`

- [ ] **Step 1: Add review action panel**

In the task detail drawer, at the active human review step, show a review panel with:

1. **Decision buttons:** `[Approve]` `[Request Revision]` `[Reject]`
2. **Note textarea** (required for rejection/revision, optional for approval)
3. **Reassign dropdown** (shown on Reject — lists agents in the project)
4. **Sign-off progress** if `requiredSignOffs > 1`: "1 of 2 approvals received"
5. **Previous reviews** for this step (who approved/rejected and their notes)

The panel calls `PUT /api/tasks/[id]/steps/[stepId]` with `action: 'review'` and the `stepReviewSchema` payload.

- [ ] **Step 2: Add review history section**

Below the action panel, show a timeline of all reviews for this step (from `StepReview` records). Each entry shows: reviewer name, decision badge, note, timestamp.

- [ ] **Step 3: Commit**

```bash
git add src/components/task-detail-drawer.tsx
git commit -m "feat: add review action panel with sign-offs and reassignment to task detail drawer"
```

---

## Summary

| Task | File(s) | What changes |
|------|---------|-------------|
| 1 | `schema.prisma`, `contracts.ts` | StepReview model + sign-off fields + review schema |
| 2 | `review-logic.ts` | Review decision engine (approve, reject, revise, reassign) |
| 3 | `steps/[stepId]/route.ts` | Wire review action into step API |
| 4 | `attempt-comparison.tsx`, `step-output-viewer.tsx` | Side-by-side attempt comparison |
| 5 | `task-detail-drawer.tsx` | Review action panel with sign-offs |

**After this, the human review flow is:**
Agent completes step → chain advances to human review step → reviewer sees output + attempt history → reviewer can: approve (counting toward required sign-offs), request revision (rewind with feedback), reject (rewind with new agent assignment), or reject and close → all decisions recorded in StepReview → chain continues when all sign-offs met
