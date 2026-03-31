import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createTaskSchema } from '@/lib/server/contracts'
import { normalizeDagEdges } from '@/lib/server/dispatch'
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

    const steps = parsed.data.steps

    // Validate step agents (including fallback agents) before transaction
    if (steps && steps.length > 0) {
      const stepAgentIds = [
        ...steps.map(s => s.agentId),
        ...steps.map(s => s.fallbackAgentId),
      ].filter((id): id is string => !!id)
      if (stepAgentIds.length > 0) {
        const uniqueIds = [...new Set(stepAgentIds)]
        const agents = await db.agent.findMany({
          where: { id: { in: uniqueIds } },
          select: { id: true, projectId: true },
        })
        const invalidAgent = agents.find(a => a.projectId !== projectId)
        if (invalidAgent || agents.length !== uniqueIds.length) {
          return NextResponse.json(
            { error: 'All step agents (including fallback agents) must belong to the same project' },
            { status: 400 },
          )
        }
      }
    }

    // Create task and steps atomically
    const task = await db.$transaction(async (tx) => {
      const maxOrderTask = await tx.task.findFirst({
        where: { projectId, status: status || 'BACKLOG' },
        orderBy: { order: 'desc' },
      })

      const order = (maxOrderTask?.order || 0) + 1

      const created = await tx.task.create({
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
      })

      if (steps && steps.length > 0) {
        // Create steps without edge data first
        await tx.taskStep.createMany({
          data: steps.map((step, index) => ({
            taskId: created.id,
            order: index + 1,
            agentId: step.agentId || null,
            humanLabel: step.humanLabel || null,
            mode: step.mode,
            instructions: step.instructions || null,
            autoContinue: step.autoContinue ?? (step.mode !== 'human'),
            maxRetries: step.maxRetries ?? 2,
            retryDelayMs: step.retryDelayMs ?? 5000,
            timeoutMs: step.timeoutMs ?? 300000,
            isParallelRoot: step.isParallelRoot ?? false,
            isMergePoint: step.isMergePoint ?? false,
            fallbackAgentId: step.fallbackAgentId || null,
            requiredSignOffs: step.requiredSignOffs ?? 1,
          })),
        })

        // Validate DAG edges for cycles before persisting
        const hasDagEdges = steps.some(s => s.nextSteps?.length || s.prevSteps?.length)
        if (hasDagEdges) {
          // Build adjacency list from client-side edges and detect cycles via DFS
          const adj = new Map<string, string[]>()
          steps.forEach((step, i) => {
            const clientId = `step_${i}`
            adj.set(clientId, (step.nextSteps || []).map(e => e.targetStepId))
          })
          // Add reverse edges from prevSteps so cycles expressed purely through
          // prevSteps are also detected before normalizeDagEdges bakes them in.
          steps.forEach((step, i) => {
            const prevIds = step.prevSteps || []
            for (const prevId of prevIds) {
              const existing = adj.get(prevId) || []
              if (!existing.includes(`step_${i}`)) {
                adj.set(prevId, [...existing, `step_${i}`])
              }
            }
          })
          const WHITE = 0, GRAY = 1, BLACK = 2
          const color = new Map<string, number>()
          adj.forEach((_, k) => color.set(k, WHITE))
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
            throw new Error('DAG edges contain a cycle — circular references are not allowed')
          }
          const createdSteps = await tx.taskStep.findMany({
            where: { taskId: created.id },
            select: { id: true, order: true },
            orderBy: { order: 'asc' },
          })

          // Build mapping: client ID (e.g. "step_0") → real DB ID
          // Client IDs follow the pattern step_<index> where index is 0-based
          const idMap = new Map<string, string>()
          for (let i = 0; i < steps.length; i++) {
            const clientId = `step_${i}`
            if (createdSteps[i]) {
              idMap.set(clientId, createdSteps[i].id)
            }
          }

          // Update each step's edges with remapped IDs
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            const dbStep = createdSteps[i]
            if (!dbStep) continue

            const remappedNext = step.nextSteps?.map(edge => ({
              ...edge,
              targetStepId: idMap.get(edge.targetStepId) || edge.targetStepId,
            }))
            const remappedPrev = step.prevSteps?.map(id => idMap.get(id) || id)

            if (remappedNext?.length || remappedPrev?.length) {
              await tx.taskStep.update({
                where: { id: dbStep.id },
                data: {
                  nextSteps: remappedNext?.length ? JSON.stringify(remappedNext) : null,
                  prevSteps: remappedPrev?.length ? JSON.stringify(remappedPrev) : null,
                },
              })
            }
          }
        }
      }

      return tx.task.findUniqueOrThrow({
        where: { id: created.id },
        include: taskBoardInclude,
      })
    })

    // Normalize DAG edge symmetry (synthesize missing nextSteps from prevSteps and vice versa)
    await normalizeDagEdges(task.id)

    await broadcastProjectEvent(projectId, 'task-created', task)
    return NextResponse.json(task)
  } catch (error) {
    console.error('Error creating task:', error)
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
  }
}
