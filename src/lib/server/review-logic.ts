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
  const approvalCount = step.reviews.filter(r => r.decision === 'approved').length + 1

  if (approvalCount >= step.requiredSignOffs) {
    await db.taskStep.update({
      where: { id: step.id },
      data: { status: 'done', completedAt: new Date() },
    })
    await advanceChain(step.taskId, input.projectId)
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
  const currentStep = await db.taskStep.findUnique({
    where: { id: step.id },
    select: { order: true },
  })

  const previousAgentStep = await db.taskStep.findFirst({
    where: {
      taskId: step.taskId,
      order: { lt: currentStep!.order },
      mode: { not: 'human' },
    },
    orderBy: { order: 'desc' },
  })

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
  const currentStep = await db.taskStep.findUnique({
    where: { id: step.id },
    select: { order: true },
  })

  const previousAgentStep = await db.taskStep.findFirst({
    where: {
      taskId: step.taskId,
      order: { lt: currentStep!.order },
      mode: { not: 'human' },
    },
    orderBy: { order: 'desc' },
  })

  if (!previousAgentStep) {
    throw new Error('No previous agent step to request revision from')
  }

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

  return { action: 'revision_requested' }
}
