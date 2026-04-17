import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateTaskSchema } from '@/lib/server/contracts'
import { startChain } from '@/lib/server/dispatch'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

export const GET = withErrorHandling(
  'api/tasks/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      include: taskBoardInclude,
    })

    if (!task) throw notFound('Task not found')

    return NextResponse.json(task)
  },
)

export const PUT = withErrorHandling(
  'api/tasks/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const existingTask = await db.task.findUnique({
      where: { id },
      select: { projectId: true, status: true },
    })

    if (!existingTask) throw notFound('Task not found')

    const parsed = updateTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid task payload')
    }

    const previousStatus = existingTask.status
    const { agentId } = parsed.data
    if (agentId) {
      const agent = await db.agent.findUnique({
        where: { id: agentId },
        select: { projectId: true },
      })

      if (!agent || agent.projectId !== existingTask.projectId) {
        throw badRequest('Assigned agent must belong to the same project')
      }
    }

    const task = await db.task.update({
      where: { id },
      data: parsed.data,
      include: taskBoardInclude,
    })

    if (parsed.data.status && parsed.data.status !== previousStatus) {
      broadcastProjectEvent(task.projectId, 'task-moved', {
        taskId: task.id,
        task,
      })
    } else {
      broadcastProjectEvent(task.projectId, 'task-updated', task)
    }

    if (parsed.data.status === 'IN_PROGRESS' && task.steps && task.steps.length > 0) {
      const hasActiveStep = task.steps.some((s) => s.status === 'active')
      const hasCompletedSteps = task.steps.some((s) => s.status === 'done' || s.status === 'skipped')
      if (!hasActiveStep && !hasCompletedSteps) {
        // Only start chain if no steps have been touched yet
        try {
          await startChain(task.id, task.projectId)
        } catch (chainErr) {
          console.error('startChain failed:', chainErr)
        }
      }
    }

    return NextResponse.json(task)
  },
)

export const DELETE = withErrorHandling(
  'api/tasks/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    })

    if (!task) throw notFound('Task not found')

    await db.task.delete({ where: { id } })

    broadcastProjectEvent(task.projectId, 'task-deleted', task.id)

    return NextResponse.json({ success: true })
  },
)
