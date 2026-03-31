import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { dispatchStep, advanceChain, rewindChain, closeChain, findPreviousAgentStep } from '@/lib/server/dispatch'
import { submitReview } from '@/lib/server/review-logic'
import { stepReviewSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params
    const body = await request.json()

    const existingStep = await db.taskStep.findUnique({
      where: { id: stepId },
      include: { task: { select: { projectId: true } } },
    })

    if (!existingStep || existingStep.taskId !== id) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const projectId = existingStep.task.projectId

    // Handle retry action
    if (body.action === 'retry' && existingStep.status === 'failed') {
      await db.taskStep.update({
        where: { id: stepId },
        data: { status: 'active', error: null, startedAt: new Date(), completedAt: null },
      })
      dispatchStep(stepId).catch(console.error)
      return NextResponse.json({ success: true, action: 'retrying' })
    }

    // Handle skip action
    if (body.action === 'skip' && existingStep.status === 'failed') {
      await db.taskStep.update({
        where: { id: stepId },
        data: { status: 'skipped', completedAt: new Date() },
      })
      await advanceChain(existingStep.taskId, projectId, stepId)
      return NextResponse.json({ success: true, action: 'skipped' })
    }

    // Handle reject → redo (rewind to previous agent step)
    if (body.action === 'reject' && body.target === 'redo') {
      const note = typeof body.note === 'string' ? body.note : ''
      if (!note) {
        return NextResponse.json({ error: 'Rejection note is required' }, { status: 400 })
      }

      const previousAgentStep = await findPreviousAgentStep(id, stepId)

      if (!previousAgentStep) {
        return NextResponse.json({ error: 'No previous agent step to redo' }, { status: 400 })
      }

      await db.taskStep.update({
        where: { id: stepId },
        data: { status: 'pending', output: null, completedAt: null },
      })

      await rewindChain(id, projectId, previousAgentStep.id, note)
      return NextResponse.json({ success: true, action: 'rewound', targetStepId: previousAgentStep.id })
    }

    // Handle reject → reassign (rewind to previous agent step with a different agent)
    if (body.action === 'reject' && body.target === 'reassign') {
      const note = typeof body.note === 'string' ? body.note : ''
      if (!note) {
        return NextResponse.json({ error: 'Rejection note is required' }, { status: 400 })
      }
      if (!body.reassignAgentId) {
        return NextResponse.json({ error: 'reassignAgentId is required for reassign' }, { status: 400 })
      }

      // Validate reassign agent belongs to same project
      const reassignAgent = await db.agent.findUnique({
        where: { id: body.reassignAgentId },
        select: { projectId: true },
      })
      if (!reassignAgent || reassignAgent.projectId !== existingStep.task.projectId) {
        return NextResponse.json(
          { error: 'Reassign agent must belong to the same project' },
          { status: 400 },
        )
      }

      const previousAgentStep = await findPreviousAgentStep(id, stepId)

      if (!previousAgentStep) {
        return NextResponse.json({ error: 'No previous agent step to reassign' }, { status: 400 })
      }

      // Switch the agent on the target step
      await db.taskStep.update({
        where: { id: previousAgentStep.id },
        data: {
          agentId: body.reassignAgentId,
          ...(body.reassignMode && { mode: body.reassignMode }),
        },
      })

      // Reset current human step to pending
      await db.taskStep.update({
        where: { id: stepId },
        data: { status: 'pending', output: null, completedAt: null },
      })

      await rewindChain(id, projectId, previousAgentStep.id, note)
      return NextResponse.json({
        success: true,
        action: 'reassigned',
        targetStepId: previousAgentStep.id,
        reassignedTo: body.reassignAgentId,
      })
    }

    // Handle reject → close (kill the chain)
    if (body.action === 'reject' && body.target === 'close') {
      const note = typeof body.note === 'string' ? body.note : 'Rejected by human'
      await closeChain(id, projectId, note)
      return NextResponse.json({ success: true, action: 'closed' })
    }

    // Handle review decision (approve, reject, revision_requested)
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

    // Generic update (status, output, error)
    const updateData: Record<string, unknown> = {}

    // Validate state transitions
    if (typeof body.status === 'string') {
      const validTransitions: Record<string, string[]> = {
        pending: ['active'],
        active: ['done', 'failed'],
        done: [],  // terminal
        failed: ['active', 'skipped'],  // retry or skip
        skipped: [],  // terminal
      }
      const allowed = validTransitions[existingStep.status] || []
      if (!allowed.includes(body.status)) {
        return NextResponse.json(
          { error: `Cannot transition step from "${existingStep.status}" to "${body.status}"` },
          { status: 400 },
        )
      }
      updateData.status = body.status
    }
    if (typeof body.output === 'string') {
      updateData.output = body.output
    }
    if (typeof body.error === 'string') {
      updateData.error = body.error
    }
    if (body.status === 'done' && !existingStep.completedAt) {
      updateData.completedAt = new Date()
    }

    // Compare-and-set: only update if the step is still in the expected status,
    // preventing double advanceChain from concurrent PUT requests.
    const updated = await db.taskStep.updateMany({
      where: { id: stepId, status: existingStep.status },
      data: updateData,
    })

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Step already updated (concurrent request)' }, { status: 409 })
    }

    // updateMany doesn't support include, so fetch the updated step separately.
    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      include: {
        agent: { select: { id: true, name: true, emoji: true } },
      },
    })

    // If step was just marked done, advance the chain
    if (updateData.status === 'done') {
      try {
        await advanceChain(id, projectId, stepId)
      } catch (chainErr) {
        console.error('advanceChain failed after step completion:', chainErr)
        await db.task.update({
          where: { id },
          data: { status: 'WAITING' },
        }).catch(console.error)
      }
    }

    return NextResponse.json(step)
  } catch (error) {
    console.error('Error updating step:', error)
    return NextResponse.json({ error: 'Failed to update step' }, { status: 500 })
  }
}
