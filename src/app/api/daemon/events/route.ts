import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { liveAgentEventSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export const POST = withErrorHandling('api/daemon/events', async (request: Request) => {
  const rawToken = extractDaemonToken(request)
  if (!rawToken) throw unauthorized('Missing daemon token')

  const daemon = await resolveDaemonByToken(rawToken)
  if (!daemon) throw unauthorized('Invalid daemon token')

  const body = await request.json()
  const { taskId, stepId, event } = body as {
    taskId?: string
    stepId?: string
    event?: unknown
  }

  if (!taskId || !event) throw badRequest('taskId and event are required')

  const parsed = liveAgentEventSchema.safeParse(event)
  if (!parsed.success) throw badRequest('Invalid event shape')

  // Scope the task to the daemon's own workspace. Without this check, a daemon
  // token from workspace A could broadcast events on any task ID in workspace B
  // (spoofing live-feed rows to subscribers of the other workspace).
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, project: { select: { workspaceId: true } } },
  })

  if (!task) throw notFound('Task not found')
  if (task.project.workspaceId !== daemon.workspaceId) {
    throw forbidden('Task does not belong to this daemon\'s workspace')
  }

  broadcastProjectEvent(task.projectId, 'agent-live-event', {
    source: 'daemon' as const,
    daemonId: daemon.id,
    taskId,
    stepId,
    event: parsed.data,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ status: 'ok' })
})
