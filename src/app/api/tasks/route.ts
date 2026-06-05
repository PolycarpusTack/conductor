import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { authorizeAdminOrScopedKey } from '@/lib/server/api-auth'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { scanForPromptInjection, wrapExternalContent } from '@/lib/server/content-safety'
import { createTaskSchema } from '@/lib/server/contracts'
import { normalizeDagEdges, startChain } from '@/lib/server/dispatch'
import { getLogger } from '@/lib/server/logger'
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
import { taskBoardInclude } from '@/lib/server/selects'
import { captureTraceContext } from '@/lib/server/telemetry'

const log = getLogger('api/tasks')

export const GET = withErrorHandling('api/tasks', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

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
})

export const POST = withErrorHandling('api/tasks', async (request: Request) => {
  // Admin session (with CSRF check) OR a scoped API key with "write" —
  // lets webhooks and scripts create tasks without a browser session.
  const auth = await authorizeAdminOrScopedKey(request, 'write')
  if (!auth.ok) return auth.response

  const parsed = createTaskSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid task payload')
  }

  const { title, status, priority, tag, projectId, agentId, notes, runtimeOverride } = parsed.data
  let { description } = parsed.data

  // Key-created tasks are external content: their description flows into
  // agent prompts at dispatch. Scan always; wrap as data when flagged.
  if (auth.via === 'key') {
    const scanned = scanForPromptInjection(
      [title, description, ...(parsed.data.steps ?? []).map((s) => s.instructions)].filter(Boolean).join('\n'),
    )
    if (scanned.length > 0) {
      if (description) {
        description = wrapExternalContent({
          text: description,
          source: 'api:tasks',
          trust: 'external',
        }).text
      }
      void db.activityLog.create({
        data: {
          action: 'content_safety_flagged',
          level: 'warn',
          component: 'system',
          projectId,
          details: JSON.stringify({
            source: 'api:tasks',
            keyId: auth.keyId,
            categories: [...new Set(scanned.map((f) => f.category))],
          }),
        },
      }).catch(() => {})
    }
  }

  if (agentId) {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { projectId: true },
    })

    if (!agent || agent.projectId !== projectId) {
      throw badRequest('Assigned agent must belong to the same project')
    }
  }

  let steps = parsed.data.steps

  // Project default (Epic S1): a task created WITH an agent but WITHOUT steps
  // and WITHOUT an explicit status gets a single auto-step in the project's
  // default mode — so "assign an agent" actually dispatches, as the guide
  // describes. An explicit status (e.g. BACKLOG) opts out.
  if (agentId && (!steps || steps.length === 0) && !status) {
    const projectDefaults = await db.project.findUnique({
      where: { id: projectId },
      select: { defaultStepMode: true },
    })
    steps = [{
      mode: projectDefaults?.defaultStepMode || 'develop',
      agentId,
      autoContinue: true,
    }]
  }

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
        throw badRequest('All step agents (including fallback agents) must belong to the same project')
      }
    }
  }

    // A task created with a chain (steps[] non-empty) and no explicit status
    // starts IN_PROGRESS so the user doesn't have to hunt for a trigger to
    // kick off the workflow they just built. Plain tasks (no steps) keep the
    // BACKLOG default so they don't dispatch accidentally.
    const effectiveStatus = status || (steps && steps.length > 0 ? 'IN_PROGRESS' : 'BACKLOG')

    // Create task and steps atomically
    const task = await db.$transaction(async (tx) => {
      const maxOrderTask = await tx.task.findFirst({
        where: { projectId, status: effectiveStatus },
        orderBy: { order: 'desc' },
      })

      const order = (maxOrderTask?.order || 0) + 1

      const created = await tx.task.create({
        data: {
          title,
          description,
          status: effectiveStatus,
          priority: priority || 'MEDIUM',
          tag,
          projectId,
          agentId,
          notes,
          runtimeOverride,
          order,
        },
      })

      if (steps && steps.length > 0) {
        // Capture the request's trace context once — every step of this task
        // links back to the HTTP request that created it.
        const traceContext = captureTraceContext()

        // Create steps without edge data first
        await tx.taskStep.createMany({
          data: steps.map((step, index) => ({
            taskId: created.id,
            traceContext,
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
            throw badRequest('DAG edges contain a cycle — circular references are not allowed')
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

          // Remap client step IDs (step_N) to real DB IDs. Reject any edge
          // that references a client ID we never created — silently preserving
          // the raw string would persist a dangling edge that the runtime
          // can't satisfy, and the task would never advance past that step.
          const remapOrFail = (raw: string): string => {
            const mapped = idMap.get(raw)
            if (!mapped) {
              throw badRequest(`Unknown step reference: ${raw}`)
            }
            return mapped
          }

          // Update each step's edges with remapped IDs
          for (let i = 0; i < steps.length; i++) {
            const step = steps[i]
            const dbStep = createdSteps[i]
            if (!dbStep) continue

            const remappedNext = step.nextSteps?.map(edge => ({
              ...edge,
              targetStepId: remapOrFail(edge.targetStepId),
            }))
            const remappedPrev = step.prevSteps?.map(remapOrFail)

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

  // Auto-start chain when a task was created IN_PROGRESS with steps. The PUT
  // handler fires startChain on a BACKLOG→IN_PROGRESS transition, but POST
  // didn't have the matching hook, so chain tasks created via "Create Task"
  // used to sit inert. Failures are logged rather than failing the request —
  // the task exists, worst case the user drags it to In Progress by hand.
  if (effectiveStatus === 'IN_PROGRESS' && steps && steps.length > 0) {
    try {
      await startChain(task.id, projectId)
    } catch (err) {
      log.error('startChain failed on task creation', err, { taskId: task.id })
    }
  }

  broadcastProjectEvent(projectId, 'task-created', task)
  return NextResponse.json(task)
})
