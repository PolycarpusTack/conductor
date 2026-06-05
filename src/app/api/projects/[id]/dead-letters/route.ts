import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { appendStepEvent } from '@/lib/server/step-events'

/** GET /api/projects/[id]/dead-letters — exhausted steps for this project */
export const GET = withErrorHandling(
  'api/projects/[id]/dead-letters',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params

    // DeadLetterStep is deliberately relation-free; scope via the task ids
    const tasks = await db.task.findMany({
      where: { projectId },
      select: { id: true, title: true },
    })
    const titleByTask = new Map(tasks.map((t) => [t.id, t.title]))

    const deadLetters = await db.deadLetterStep.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) } },
      orderBy: { movedAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({
      deadLetters: deadLetters.map((dl) => ({
        ...dl,
        taskTitle: titleByTask.get(dl.taskId) ?? null,
      })),
    })
  },
)

const requeueSchema = z.object({ deadLetterId: z.string().min(1) })

/**
 * POST /api/projects/[id]/dead-letters — requeue a dead-lettered step.
 * Resets the original step for a fresh retry cycle and removes the
 * dead-letter row (the step's own event log keeps the full history).
 */
export const POST = withErrorHandling(
  'api/projects/[id]/dead-letters',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id: projectId } = await params
    const parsed = requeueSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw badRequest('deadLetterId is required')

    const deadLetter = await db.deadLetterStep.findUnique({
      where: { id: parsed.data.deadLetterId },
    })
    if (!deadLetter) throw notFound('Dead letter not found')

    const step = await db.taskStep.findUnique({
      where: { id: deadLetter.originalStepId },
      select: { id: true, task: { select: { projectId: true } } },
    })
    if (!step || step.task.projectId !== projectId) {
      throw notFound('Original step no longer exists in this project')
    }

    await db.taskStep.update({
      where: { id: step.id },
      data: {
        status: 'active',
        error: null,
        attempts: 0,
        completedAt: null,
        leasedBy: null,
        leasedAt: null,
      },
    })
    await db.deadLetterStep.delete({ where: { id: deadLetter.id } })
    await appendStepEvent(step.id, 'retry_scheduled', {
      reason: 'requeued-from-dead-letter',
      deadLetterId: deadLetter.id,
    })

    return NextResponse.json({ success: true, stepId: step.id })
  },
)
