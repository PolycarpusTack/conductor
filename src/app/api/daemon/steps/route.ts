import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
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
    const { stepId, action, output, error: errorMsg, willRetry } = body as {
      stepId?: string
      action?: 'complete' | 'fail'
      output?: string
      error?: string
      willRetry?: boolean
    }

    if (!stepId || !action) {
      return NextResponse.json(
        { error: 'stepId and action are required' },
        { status: 400 },
      )
    }

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        taskId: true,
        status: true,
        leasedBy: true,
        task: { select: { projectId: true } },
      },
    })

    if (!step) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    if (step.leasedBy !== daemon.id) {
      return NextResponse.json(
        { error: 'Step is not leased by this daemon' },
        { status: 403 },
      )
    }

    if (action === 'complete') {
      const truncated = output ? output.length > 5000 : false
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          status: 'completed',
          output: output?.slice(0, 5000),
          completedAt: new Date(),
        },
      })

      broadcastProjectEvent(step.task.projectId, 'daemon-step-completed', {
        stepId,
        taskId: step.taskId,
        daemonId: daemon.id,
        output: output?.slice(0, 500),
        truncated,
      })
    } else if (action === 'fail') {
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          status: willRetry ? 'pending' : 'failed',
          error: errorMsg?.slice(0, 5000),
          attempts: { increment: 1 },
        },
      })

      broadcastProjectEvent(step.task.projectId, 'daemon-step-failed', {
        stepId,
        taskId: step.taskId,
        daemonId: daemon.id,
        error: errorMsg?.slice(0, 500),
        willRetry,
      })
    }

    return NextResponse.json({ status: 'ok', stepId, action })
  } catch (error) {
    console.error('Daemon step update error:', error)
    return NextResponse.json({ error: 'Failed to update step' }, { status: 500 })
  }
}
