import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/**
 * Agent HTTP API - Get next available task
 * 
 * GET /api/agent/next
 * Returns the highest priority task that is either:
 * - Unassigned and in BACKLOG
 * - Assigned to this agent and in BACKLOG or IN_PROGRESS
 */
export async function GET(request: Request) {
  try {
    const apiKey = extractAgentApiKey(request)

    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Missing agent API key',
          hint: 'Use Authorization: Bearer <agent-key> or X-Agent-Key header',
        },
        { status: 401 },
      )
    }

    const agent = await resolveAgentByApiKey(apiKey)

    if (!agent) {
      return NextResponse.json({
        error: 'Invalid API key',
        hint: 'Check your agent API key in the AgentBoard UI',
      }, { status: 401 })
    }

    // Update agent last seen
    await db.agent.update({
      where: { id: agent.id },
      data: { lastSeen: new Date(), isActive: true },
    })

    await broadcastProjectEvent(agent.projectId, 'agent-status', {
      agentId: agent.id,
      isActive: true,
    })

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
        suggestion: 'Claim this task using action=claim',
      })
    }

    return NextResponse.json({
      message: 'No tasks available',
      task: null,
      suggestion: 'Check back later or contact your project manager',
    })
  } catch (error) {
    console.error('Error fetching next task:', error)
    return NextResponse.json({ error: 'Failed to fetch next task' }, { status: 500 })
  }
}
