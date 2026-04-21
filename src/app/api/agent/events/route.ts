import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'
import { liveAgentEventSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export const POST = withErrorHandling('api/agent/events', async (request: Request) => {
  const apiKey = extractAgentApiKey(request)
  if (!apiKey) throw unauthorized('Missing agent API key')

  const agent = await resolveAgentByApiKey(apiKey)
  if (!agent) throw unauthorized('Invalid API key')

  const body = await request.json()
  const { taskId, stepId, event } = body as {
    taskId?: string
    stepId?: string
    event?: unknown
  }

  if (!taskId || !event) throw badRequest('taskId and event are required')

  const parsed = liveAgentEventSchema.safeParse(event)
  if (!parsed.success) throw badRequest('Invalid event shape')

  // Scope: the agent can only emit on tasks in its own project. Without this
  // check an agent in project A could spoof events for tasks in project B by
  // guessing a task ID — the broadcast would reach project-B subscribers.
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  })

  if (!task) throw notFound('Task not found')
  if (task.projectId !== agent.projectId) {
    throw forbidden('Task does not belong to this agent\'s project')
  }

  // If a stepId is provided, verify it belongs to this task. Prevents spoofing
  // events that claim to be from a different step (which would mislabel the
  // live feed even though the project scope is correct).
  if (stepId) {
    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })
    if (!step || step.taskId !== taskId) {
      throw notFound('Step not found on this task')
    }
  }

  broadcastProjectEvent(task.projectId, 'agent-live-event', {
    source: 'http' as const,
    agentId: agent.id,
    taskId,
    stepId,
    event: parsed.data,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
})
