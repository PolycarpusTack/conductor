import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateTaskSchema } from '@/lib/server/contracts'
import { startChain } from '@/lib/server/dispatch'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      include: taskBoardInclude,
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error('Error fetching task:', error)
    return NextResponse.json({ error: 'Failed to fetch task' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    const existingTask = await db.task.findUnique({
      where: { id },
      select: { projectId: true, status: true },
    })

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const parsed = updateTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid task payload' },
        { status: 400 },
      )
    }

    const previousStatus = existingTask.status
    const { agentId } = parsed.data
    if (agentId) {
      const agent = await db.agent.findUnique({
        where: { id: agentId },
        select: { projectId: true },
      })

      if (!agent || agent.projectId !== existingTask.projectId) {
        return NextResponse.json(
          { error: 'Assigned agent must belong to the same project' },
          { status: 400 },
        )
      }
    }

    const task = await db.task.update({
      where: { id },
      data: parsed.data,
      include: taskBoardInclude,
    })

    if (parsed.data.status && parsed.data.status !== previousStatus) {
      await broadcastProjectEvent(task.projectId, 'task-moved', {
        taskId: task.id,
        task,
      })
    } else {
      await broadcastProjectEvent(task.projectId, 'task-updated', task)
    }

    if (parsed.data.status === 'IN_PROGRESS' && task.steps && task.steps.length > 0) {
      const hasActiveStep = task.steps.some((s: any) => s.status === 'active')
      const hasCompletedSteps = task.steps.some((s: any) => s.status === 'done' || s.status === 'skipped')
      if (!hasActiveStep && !hasCompletedSteps) {
        // Only start chain if no steps have been touched yet
        startChain(task.id, task.projectId).catch(console.error)
      }
    }

    return NextResponse.json(task)
  } catch (error) {
    console.error('Error updating task:', error)
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    await db.task.delete({
      where: { id },
    })

    await broadcastProjectEvent(task.projectId, 'task-deleted', task.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting task:', error)
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
  }
}
