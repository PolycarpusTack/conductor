import { NextResponse } from 'next/server'

import type { z } from 'zod'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { MAX_OUTPUT_CHARS } from '@/lib/server/constants'
import { stepArtifactSchema } from '@/lib/server/contracts'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { advanceChain, resolveTaskStatus } from '@/lib/server/dispatch'
import { getLogger } from '@/lib/server/logger'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { appendStepEvent } from '@/lib/server/step-events'

const log = getLogger('api/daemon/steps')

// A-3: evidence artifacts riding a completion report (git diff --stat, run
// metadata). Bounded — a daemon must not be able to flood the artifact table.
const MAX_REPORT_ARTIFACTS = 10

export const POST = withErrorHandling('api/daemon/steps', async (request: Request) => {
    const rawToken = extractDaemonToken(request)
    if (!rawToken) throw unauthorized('Missing daemon token')

    const daemon = await resolveDaemonByToken(rawToken)
    if (!daemon) throw unauthorized('Invalid daemon token')

    const body = await request.json()
    const { stepId, action, output, error: errorMsg, willRetry, sessionId, artifacts } = body as {
      stepId?: string
      action?: 'complete' | 'fail'
      output?: string
      error?: string
      willRetry?: boolean
      sessionId?: string
      artifacts?: unknown
    }

    if (!stepId || !action) throw badRequest('stepId and action are required')

    // A-3: evidence artifacts are accepted on BOTH actions — a failed step's
    // git evidence is exactly what a reviewer needs. Validated up front (same
    // schema as the agent completion path) so a bad report changes nothing.
    const parsedArtifacts: Array<z.infer<typeof stepArtifactSchema>> = []
    if (artifacts !== undefined) {
      if (!Array.isArray(artifacts)) throw badRequest('artifacts must be an array')
      if (artifacts.length > MAX_REPORT_ARTIFACTS) {
        throw badRequest(`too many artifacts (max ${MAX_REPORT_ARTIFACTS})`)
      }
      for (const [index, raw] of artifacts.entries()) {
        const parsed = stepArtifactSchema.safeParse(raw)
        if (!parsed.success) {
          throw badRequest(`artifacts[${index}]: ${parsed.error.issues[0]?.message || 'invalid artifact'}`)
        }
        parsedArtifacts.push(parsed.data)
      }
    }

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        taskId: true,
        status: true,
        leasedBy: true,
        retryDelayMs: true,
        attempts: true,
        task: { select: { projectId: true } },
      },
    })

    if (!step) throw notFound('Step not found')

    if (step.leasedBy !== daemon.id) throw forbidden('Step is not leased by this daemon')

    // Optional session linkage — the durable step↔session evidence link.
    // Only sessions owned by the calling daemon may be attached.
    if (sessionId) {
      const session = await db.agentSession.findUnique({
        where: { id: sessionId },
        select: { id: true, daemonId: true, taskId: true, stepId: true },
      })
      if (!session) throw notFound('Session not found')
      if (session.daemonId !== daemon.id) {
        throw forbidden('Session is owned by a different daemon')
      }
      if (!session.stepId || !session.taskId) {
        await db.agentSession.update({
          where: { id: sessionId },
          data: {
            stepId: session.stepId ?? stepId,
            taskId: session.taskId ?? step.taskId,
          },
        })
      }
    }

    const persistArtifacts = async () => {
      for (const artifact of parsedArtifacts) {
        await db.stepArtifact.create({
          data: {
            stepId,
            type: artifact.type,
            label: artifact.label,
            content: artifact.content || null,
            url: artifact.url || null,
            mimeType: artifact.mimeType || null,
            metadata: artifact.metadata ? JSON.stringify(artifact.metadata) : null,
          },
        })
      }
    }

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

      await persistArtifacts()

      await appendStepEvent(stepId, 'succeeded', {
        source: 'daemon',
        daemonId: daemon.id,
        ...(sessionId ? { sessionId } : {}),
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

      await persistArtifacts()

      await appendStepEvent(stepId, 'failed', {
        source: 'daemon',
        daemonId: daemon.id,
        attempt: step.attempts + 1,
        error: errorMsg?.slice(0, 500),
        ...(sessionId ? { sessionId } : {}),
      })
      if (willRetry) {
        await appendStepEvent(stepId, 'retry_scheduled', {
          source: 'daemon',
          attempt: step.attempts + 1,
          delayMs: retryDelayMs,
        })
      }

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
