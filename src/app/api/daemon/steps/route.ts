import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { MAX_OUTPUT_CHARS } from '@/lib/server/constants'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { advanceChain, resolveTaskStatus } from '@/lib/server/dispatch'
import { getLogger } from '@/lib/server/logger'
import { broadcastProjectEvent } from '@/lib/server/realtime'

const log = getLogger('api/daemon/steps')

export const POST = withErrorHandling('api/daemon/steps', async (request: Request) => {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) throw unauthorized('Missing daemon token')

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) throw unauthorized('Invalid daemon token')

    const body = await request.json()
    const { stepId, action, output, error: errorMsg, willRetry } = body as {
      stepId?: string
      action?: 'complete' | 'fail'
      output?: string
      error?: string
      willRetry?: boolean
    }

    if (!stepId || !action) throw badRequest('stepId and action are required')

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        taskId: true,
        status: true,
        leasedBy: true,
        retryDelayMs: true,
        task: { select: { projectId: true } },
      },
    })

    if (!step) throw notFound('Step not found')

    if (step.leasedBy !== daemon.id) throw forbidden('Step is not leased by this daemon')

    if (action === 'complete') {
      const truncated = output ? output.length > 5000 : false
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          status: 'done',
          output: output?.slice(0, MAX_OUTPUT_CHARS),
          completedAt: new Date(),
          leasedBy: null,
          leasedAt: null,
        },
      })

      broadcastProjectEvent(step.task.projectId, 'daemon-step-completed', {
        stepId,
        taskId: step.taskId,
        daemonId: daemon.id,
        output: output?.slice(0, 500),
        truncated,
      })

      try {
        await advanceChain(step.taskId, step.task.projectId, stepId)
      } catch (chainErr) {
        log.error('advanceChain failed after daemon step completion', chainErr)
      }
    } else if (action === 'fail') {
      const retryDelayMs = step.retryDelayMs ?? 5000
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          // Retry: keep step 'active' so the queue re-leases it after the delay.
          // Non-retry: 'failed' is terminal.
          status: willRetry ? 'active' : 'failed',
          error: errorMsg?.slice(0, MAX_OUTPUT_CHARS),
          attempts: { increment: 1 },
          completedAt: willRetry ? null : new Date(),
          leasedBy: null,
          leasedAt: willRetry && retryDelayMs > 0 ? new Date(Date.now() + retryDelayMs) : null,
        },
      })

      // Daemon-specific event for the runtime dashboard's live log
      broadcastProjectEvent(step.task.projectId, 'daemon-step-failed', {
        stepId,
        taskId: step.taskId,
        daemonId: daemon.id,
        error: errorMsg?.slice(0, 500),
        willRetry,
      })

      // Terminal failure must drive the task state machine like HTTP-dispatched
      // failures do (see dispatch.ts:failStep). Emit the generic step-failed
      // event so the board refetches, and call resolveTaskStatus so the task
      // doesn't stay stuck in IN_PROGRESS when no other branches are active.
      if (!willRetry) {
        broadcastProjectEvent(step.task.projectId, 'step-failed', {
          taskId: step.taskId,
          stepId,
          error: errorMsg,
        })
        try {
          await resolveTaskStatus(step.taskId, step.task.projectId)
        } catch (resolveErr) {
          log.error('resolveTaskStatus failed after daemon terminal fail', resolveErr, { stepId })
        }
      }
    }

    return NextResponse.json({ status: 'ok', stepId, action })
})
