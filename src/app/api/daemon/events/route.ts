import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { daemonEventSchema } from '@/lib/server/daemon-contracts'
import { broadcastProjectEvent } from '@/lib/server/realtime'

export async function POST(request: Request) {
  try {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) {
      return NextResponse.json({ error: 'Missing daemon token' }, { status: 401 })
    }

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) {
      return NextResponse.json({ error: 'Invalid daemon token' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, stepId, event } = body as {
      taskId?: string
      stepId?: string
      event?: unknown
    }

    if (!taskId || !event) {
      return NextResponse.json(
        { error: 'taskId and event are required' },
        { status: 400 },
      )
    }

    const parsed = daemonEventSchema.safeParse(event)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid event shape' },
        { status: 400 },
      )
    }

    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    broadcastProjectEvent(task.projectId, 'daemon-agent-event', {
      taskId,
      stepId,
      daemonId: daemon.id,
      event: parsed.data,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Daemon event error:', error)
    return NextResponse.json({ error: 'Failed to process event' }, { status: 500 })
  }
}
