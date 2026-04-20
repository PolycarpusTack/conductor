import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { updateAgentHeartbeat } from '@/lib/server/agent-helpers'
import { buildWorkingMemory } from '@/lib/server/memory'

/**
 * Agent HTTP API - Get next available task
 *
 * GET /api/agent/next
 * Returns the highest priority task that is either:
 * - Unassigned and in BACKLOG
 * - Assigned to this agent and in BACKLOG or IN_PROGRESS
 */
export const GET = withErrorHandling('api/agent/next', async (request: Request) => {
  const apiKey = extractAgentApiKey(request)

  if (!apiKey) throw unauthorized('Missing agent API key')

  const agent = await resolveAgentByApiKey(apiKey)

  if (!agent) throw unauthorized('Invalid API key')

  const memoryContext = await buildWorkingMemory({
    agentId: agent.id,
    projectId: agent.projectId,
  })

    // Update agent last seen (debounced — at most one DB write per 30s per agent)
    const didWrite = await updateAgentHeartbeat(agent.id)
    if (didWrite) {
      broadcastProjectEvent(agent.projectId, 'agent-status', {
        agentId: agent.id,
        isActive: true,
      })
    }

    // Find next task:
    // 1. First, look for tasks already assigned to this agent in IN_PROGRESS
    // 2. Then, look for tasks assigned to this agent in BACKLOG
    // 3. Finally, look for unassigned tasks in BACKLOG
    const inProgressTask = await db.task.findFirst({
      where: {
        projectId: agent.projectId,
        agentId: agent.id,
        status: 'IN_PROGRESS',
      },
      orderBy: [
        { priority: 'desc' },
        { order: 'asc' },
      ],
      include: { project: { select: { name: true } } },
    })

    if (inProgressTask) {
      return NextResponse.json({
        message: 'You have a task in progress',
        task: inProgressTask,
        memoryContext,
        suggestion: 'Complete or update the in-progress task before claiming new ones',
      })
    }

    const assignedBacklogTask = await db.task.findFirst({
      where: {
        projectId: agent.projectId,
        agentId: agent.id,
        status: 'BACKLOG',
      },
      orderBy: [
        { priority: 'desc' },
        { order: 'asc' },
      ],
      include: { project: { select: { name: true } } },
    })

    if (assignedBacklogTask) {
      return NextResponse.json({
        message: 'You have an assigned task waiting',
        task: assignedBacklogTask,
        memoryContext,
        suggestion: 'Start this task when ready using action=start',
      })
    }

    // Find unassigned task
    const unassignedTask = await db.task.findFirst({
      where: {
        projectId: agent.projectId,
        agentId: null,
        status: 'BACKLOG',
      },
      orderBy: [
        { priority: 'desc' },
        { order: 'asc' },
      ],
      include: { project: { select: { name: true } } },
    })

    if (unassignedTask) {
      return NextResponse.json({
        message: 'Unassigned task available',
        task: unassignedTask,
        memoryContext,
        suggestion: 'Claim this task using action=claim',
      })
    }

  return NextResponse.json({
    message: 'No tasks available',
    task: null,
    suggestion: 'Check back later or contact your project manager',
  })
})
