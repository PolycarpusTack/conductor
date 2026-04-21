import { db } from '@/lib/db'
import { advanceChain, rewindChain, findPreviousAgentStep } from '@/lib/server/dispatch'
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'

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
    include: {
      // Only current-round reviews count toward sign-offs or duplicate-approver
      // checks. Historical reviews from before a rejection/revision are kept
      // in the DB for audit (see supersededAt) but excluded here.
      reviews: { where: { supersededAt: null } },
    },
  })

  if (!step) throw new Error('Step not found')

  // Prevent the same reviewer from approving a step multiple times (within
  // the current round — a reviewer may approve again after a revision cycle).
  if (input.decision === 'approved') {
    const existingApproval = step.reviews.find(
      r => r.reviewer === input.reviewer && r.decision === 'approved'
    )
    if (existingApproval) {
      throw new Error('This reviewer has already approved this step')
    }
  }

  const review = await db.stepReview.create({
    data: {
      stepId: input.stepId,
      reviewer: input.reviewer,
      decision: input.decision,
      note: input.note || null,
    },
  })

  broadcastProjectEvent(input.projectId, 'step-reviewed', {
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
  step: { id: string; taskId: string; requiredSignOffs: number; reviews: { decision: string; reviewer: string }[] },
  input: ReviewDecision,
) {
  // Count unique approved reviewers (the new approval from input.reviewer is +1)
  const uniqueApprovers = new Set(step.reviews.filter(r => r.decision === 'approved').map(r => r.reviewer))
  uniqueApprovers.add(input.reviewer)
  const approvalCount = uniqueApprovers.size

  if (approvalCount >= step.requiredSignOffs) {
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'done', completedAt: new Date() },
    })
    await advanceChain(step.taskId, input.projectId, step.id)
    return { action: 'approved_and_advanced', approvalCount }
  }

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
  const previousAgentStep = await findPreviousAgentStep(step.taskId, step.id)

  if (!previousAgentStep) {
    throw new Error('No previous agent step to reject to')
  }

  if (input.reassignAgentId) {
    await db.taskStep.update({
      where: { id: previousAgentStep.id },
      data: {
        agentId: input.reassignAgentId,
        ...(input.reassignMode && { mode: input.reassignMode }),
      },
    })
  }

  await db.taskStep.update({
    where: { id: step.id },
    data: { status: 'pending', output: null, completedAt: null },
  })

  // rewindChain will supersede reviews on every step it resets (including
  // this review step itself — it's downstream of the target), so no manual
  // supersede call needed here.
  await rewindChain(
    step.taskId,
    input.projectId,
    previousAgentStep.id,
    input.note || 'Rejected',
  )

  return {
    action: input.reassignAgentId ? 'rejected_and_reassigned' : 'rejected_and_rewound',
    ...(input.reassignAgentId && { reassignedTo: input.reassignAgentId }),
  }
}

async function handleRevisionRequest(
  step: { id: string; taskId: string },
  input: ReviewDecision,
) {
  const previousAgentStep = await findPreviousAgentStep(step.taskId, step.id)

  if (!previousAgentStep) {
    throw new Error('No previous agent step to request revision from')
  }

  await db.taskStep.update({
    where: { id: step.id },
    data: { status: 'pending', output: null, completedAt: null },
  })

  // rewindChain supersedes reviews on reset steps — see note in handleRejection.
  await rewindChain(
    step.taskId,
    input.projectId,
    previousAgentStep.id,
    `REVISION REQUESTED: ${input.note || 'Please revise your output'}`,
  )

  return { action: 'revision_requested' }
}
