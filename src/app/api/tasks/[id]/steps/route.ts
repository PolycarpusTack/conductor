import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { normalizeDagEdges } from '@/lib/server/dispatch'
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

    // Validate DAG edge references if provided
    const nextSteps = parsed.data.nextSteps || []
    const prevSteps = parsed.data.prevSteps || []
    const referencedIds = [
      ...nextSteps.map((e: { targetStepId: string }) => e.targetStepId),
      ...prevSteps,
    ]

    if (referencedIds.length > 0) {
      // All referenced step IDs must exist and belong to this task
      const existingSteps = await db.taskStep.findMany({
        where: { taskId: id },
        select: { id: true, nextSteps: true, prevSteps: true },
      })
      const existingIds = new Set(existingSteps.map(s => s.id))

      const invalidIds = referencedIds.filter((refId: string) => !existingIds.has(refId))
      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: `DAG edges reference non-existent step IDs in this task: ${invalidIds.join(', ')}` },
          { status: 400 },
        )
      }

      // Cycle detection: build adjacency from existing steps + the new step's edges
      const NEW_STEP_SENTINEL = '__new_step__'
      const adj = new Map<string, string[]>()
      for (const s of existingSteps) {
        const edges: Array<{ targetStepId: string }> = s.nextSteps
          ? (() => { try { return JSON.parse(s.nextSteps) } catch { return [] } })()
          : []
        adj.set(s.id, edges.map(e => e.targetStepId))
      }
      adj.set(NEW_STEP_SENTINEL, nextSteps.map((e: { targetStepId: string }) => e.targetStepId))
      // Add reverse edges: prevSteps point TO the new step
      for (const prevId of prevSteps) {
        const existing = adj.get(prevId) || []
        adj.set(prevId, [...existing, NEW_STEP_SENTINEL])
      }

      const WHITE = 0, GRAY = 1, BLACK = 2
      const color = new Map<string, number>()
      for (const k of adj.keys()) color.set(k, WHITE)
      let hasCycle = false
      function dfs(node: string) {
        color.set(node, GRAY)
        for (const neighbor of adj.get(node) || []) {
          const c = color.get(neighbor)
          if (c === GRAY) { hasCycle = true; return }
          if (c === WHITE) dfs(neighbor)
          if (hasCycle) return
        }
        color.set(node, BLACK)
      }
      for (const [node] of adj) {
        if (color.get(node) === WHITE) dfs(node)
        if (hasCycle) break
      }
      if (hasCycle) {
        return NextResponse.json(
          { error: 'DAG edges would create a cycle — circular references are not allowed' },
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
        nextSteps: nextSteps.length > 0 ? JSON.stringify(nextSteps) : null,
        prevSteps: prevSteps.length > 0 ? JSON.stringify(prevSteps) : null,
        isParallelRoot: parsed.data.isParallelRoot ?? false,
        isMergePoint: parsed.data.isMergePoint ?? false,
        fallbackAgentId: parsed.data.fallbackAgentId || null,
        requiredSignOffs: parsed.data.requiredSignOffs ?? 1,
      },
      include: {
        agent: { select: { id: true, name: true, emoji: true } },
      },
    })

    // Normalize DAG edge symmetry (synthesize missing nextSteps from prevSteps and vice versa)
    await normalizeDagEdges(id)

    return NextResponse.json(step)
  } catch (error) {
    console.error('Error creating step:', error)
    return NextResponse.json({ error: 'Failed to create step' }, { status: 500 })
  }
}
