import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { daemonEventSchema } from '@/lib/server/daemon-contracts'
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

  const parsed = daemonEventSchema.safeParse(event)
  if (!parsed.success) throw badRequest('Invalid event shape')

  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  })

  if (!task) throw notFound('Task not found')

  broadcastProjectEvent(task.projectId, 'daemon-agent-event', {
    taskId,
    stepId,
    daemonId: daemon.id,
    event: parsed.data,
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ status: 'ok' })
})
