import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createTaskSchema } from '@/lib/server/contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')
    const take = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 500)
    const skip = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0)

    const where = projectId ? { projectId } : {}

    const [tasks, total] = await Promise.all([
      db.task.findMany({
        where,
        include: taskBoardInclude,
        orderBy: [{ status: 'asc' }, { order: 'asc' }],
        take,
        skip,
      }),
      db.task.count({ where }),
    ])

    return NextResponse.json({ data: tasks, total, limit: take, offset: skip })
  } catch (error) {
    console.error('Error fetching tasks:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const parsed = createTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid task payload' },
        { status: 400 },
      )
    }

    const { title, description, status, priority, tag, projectId, agentId, notes } = parsed.data

    if (agentId) {
      const agent = await db.agent.findUnique({
        where: { id: agentId },
        select: { projectId: true },
      })

      if (!agent || agent.projectId !== projectId) {
        return NextResponse.json(
          { error: 'Assigned agent must belong to the same project' },
          { status: 400 },
        )
      }
    }

    const task = await db.$transaction(async (tx) => {
      const maxOrderTask = await tx.task.findFirst({
        where: { projectId, status: status || 'BACKLOG' },
        orderBy: { order: 'desc' },
      })

      const order = (maxOrderTask?.order || 0) + 1

      return tx.task.create({
        data: {
          title,
          description,
          status: status || 'BACKLOG',
          priority: priority || 'MEDIUM',
          tag,
          projectId,
          agentId,
          notes,
          order,
        },
        include: taskBoardInclude,
      })
    })

    if (parsed.data.steps && parsed.data.steps.length > 0) {
      // Verify all step agents belong to the same project
      const stepAgentIds = parsed.data.steps
        .map(s => s.agentId)
        .filter((id): id is string => !!id)
      if (stepAgentIds.length > 0) {
        const agents = await db.agent.findMany({
          where: { id: { in: stepAgentIds } },
          select: { id: true, projectId: true },
        })
        const invalidAgent = agents.find(a => a.projectId !== projectId)
        if (invalidAgent || agents.length !== new Set(stepAgentIds).size) {
          return NextResponse.json(
            { error: 'All step agents must belong to the same project as the task' },
            { status: 400 },
          )
        }
      }

      await db.taskStep.createMany({
        data: parsed.data.steps.map((step, index) => ({
          taskId: task.id,
          order: index + 1,
          agentId: step.agentId || null,
          humanLabel: step.humanLabel || null,
          mode: step.mode,
          instructions: step.instructions || null,
          autoContinue: step.autoContinue ?? (step.mode !== 'human'),
        })),
      })

      // Re-fetch task with steps included
      const taskWithSteps = await db.task.findUnique({
        where: { id: task.id },
        include: taskBoardInclude,
      })
      if (taskWithSteps) {
        await broadcastProjectEvent(projectId, 'task-created', taskWithSteps)
        return NextResponse.json(taskWithSteps)
      }
    }

    await broadcastProjectEvent(projectId, 'task-created', task)
    return NextResponse.json(task)
  } catch (error) {
    console.error('Error creating task:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
