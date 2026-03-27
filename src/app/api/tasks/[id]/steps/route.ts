import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { taskStepSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const steps = await db.taskStep.findMany({
      where: { taskId: id },
      include: {
        agent: { select: { id: true, name: true, emoji: true } },
      },
      orderBy: { order: 'asc' },
    })

    return NextResponse.json(steps)
  } catch (error) {
    console.error('Error fetching steps:', error)
    return NextResponse.json({ error: 'Failed to fetch steps' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      select: { status: true },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.status !== 'BACKLOG') {
      return NextResponse.json(
        { error: 'Can only add steps to BACKLOG tasks' },
        { status: 400 },
      )
    }

    const body = await request.json()
    const parsed = taskStepSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid step' },
        { status: 400 },
      )
    }

    const maxOrder = await db.taskStep.findFirst({
      where: { taskId: id },
      orderBy: { order: 'desc' },
      select: { order: true },
    })

    // Verify agent and fallback agent belong to the same project as the task
    const agentIdsToValidate = [parsed.data.agentId, parsed.data.fallbackAgentId].filter((id): id is string => !!id)
    if (agentIdsToValidate.length > 0) {
      const taskWithProject = await db.task.findUnique({
        where: { id },
        select: { projectId: true },
      })
      if (!taskWithProject) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      const agents = await db.agent.findMany({
        where: { id: { in: agentIdsToValidate } },
        select: { id: true, projectId: true },
      })
      const invalidAgent = agents.find(a => a.projectId !== taskWithProject.projectId)
      if (invalidAgent || agents.length !== new Set(agentIdsToValidate).size) {
        return NextResponse.json(
          { error: 'Step agents (including fallback) must belong to the same project as the task' },
          { status: 400 },
        )
      }
    }

    const step = await db.taskStep.create({
      data: {
        taskId: id,
        order: (maxOrder?.order || 0) + 1,
        agentId: parsed.data.agentId || null,
        humanLabel: parsed.data.humanLabel || null,
        mode: parsed.data.mode,
        instructions: parsed.data.instructions || null,
        autoContinue: parsed.data.autoContinue ?? (parsed.data.mode !== 'human'),
        maxRetries: parsed.data.maxRetries ?? 2,
        retryDelayMs: parsed.data.retryDelayMs ?? 5000,
        timeoutMs: parsed.data.timeoutMs ?? 300000,
        nextSteps: parsed.data.nextSteps ? JSON.stringify(parsed.data.nextSteps) : null,
        prevSteps: parsed.data.prevSteps ? JSON.stringify(parsed.data.prevSteps) : null,
        isParallelRoot: parsed.data.isParallelRoot ?? false,
        isMergePoint: parsed.data.isMergePoint ?? false,
        fallbackAgentId: parsed.data.fallbackAgentId || null,
        requiredSignOffs: parsed.data.requiredSignOffs ?? 1,
      },
      include: {
        agent: { select: { id: true, name: true, emoji: true } },
      },
    })

    return NextResponse.json(step)
  } catch (error) {
    console.error('Error creating step:', error)
    return NextResponse.json({ error: 'Failed to create step' }, { status: 500 })
  }
}
