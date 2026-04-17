import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { taskStatusSchema } from '@/lib/server/contracts'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export const GET = withErrorHandling('api/agent/tasks', async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const apiKey = extractAgentApiKey(request)
  const statusParam = searchParams.get('status')

  if (!apiKey) throw unauthorized('Missing agent API key')

  const agent = await resolveAgentByApiKey(apiKey)

  if (!agent) throw unauthorized('Invalid API key')

  const parsedStatus =
    statusParam === null ? { success: true, data: undefined } : taskStatusSchema.safeParse(statusParam)
  if (!parsedStatus.success) throw badRequest('Invalid task status filter')

    await db.agent.update({
      where: { id: agent.id },
      data: { lastSeen: new Date(), isActive: true },
    })

    broadcastProjectEvent(agent.projectId, 'agent-status', {
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
})
