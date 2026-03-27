import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { taskStatusSchema } from '@/lib/server/contracts'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const apiKey = extractAgentApiKey(request)
    const statusParam = searchParams.get('status')

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
      return NextResponse.json(
        {
          error: 'Invalid API key',
          hint: 'Check your agent API key in the AgentBoard UI',
        },
        { status: 401 },
      )
    }

    const parsedStatus =
      statusParam === null ? { success: true, data: undefined } : taskStatusSchema.safeParse(statusParam)
    if (!parsedStatus.success) {
      return NextResponse.json({ error: 'Invalid task status filter' }, { status: 400 })
    }

    await db.agent.update({
      where: { id: agent.id },
      data: { lastSeen: new Date(), isActive: true },
    })

    await broadcastProjectEvent(agent.projectId, 'agent-status', {
      agentId: agent.id,
      isActive: true,
    })

    const where: { agentId: string; status?: 'BACKLOG' | 'IN_PROGRESS' | 'WAITING' | 'REVIEW' | 'DONE'; projectId: string } = {
      projectId: agent.projectId,
      agentId: agent.id,
    }

    if (parsedStatus.data) {
      where.status = parsedStatus.data
    }

    const tasks = await db.task.findMany({
      where,
      include: { project: { select: { name: true, color: true } } },
      orderBy: [{ priority: 'desc' }, { order: 'asc' }],
    })

    const project = await db.project.findUnique({
      where: { id: agent.projectId },
      select: { name: true },
    })

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        emoji: agent.emoji,
      },
      project: {
        id: agent.projectId,
        name: project?.name || 'Unknown Project',
      },
      tasks,
      count: tasks.length,
    })
  } catch (error) {
    console.error('Error fetching agent tasks:', error)
    return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
  }
}
