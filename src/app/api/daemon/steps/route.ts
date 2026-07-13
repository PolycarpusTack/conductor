import { NextResponse } from 'next/server'

import type { z } from 'zod'

import { db } from '@/lib/db'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { MAX_OUTPUT_CHARS } from '@/lib/server/constants'
import { stepArtifactSchema } from '@/lib/server/contracts'
import { extractDaemonToken, resolveDaemonByToken } from '@/lib/server/daemon-auth'
import { advanceChain, finalizeStepFailure } from '@/lib/server/dispatch'
import { findOrCreateRunningExecution, succeedExecution } from '@/lib/server/execution-log'
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
        agentId: true,
        mode: true,
        instructions: true,
        maxRetries: true,
        retryDelayMs: true,
        fallbackAgentId: true,
        attempts: true,
        task: { select: { projectId: true, title: true } },
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

    // G1-1-T4: the StepExecution row for this attempt is created at poll time
    // (steps/next). Find it — or create it defensively — so both completion paths
    // finalize a real execution row and daemon spend binds budgets (TD-018b).
    // G1-4: looked up as "the latest row iff still running", never by attempt
    // number — after a fallback escalation resets `attempts`, the failed
    // agent's terminal rows occupy the low attempt numbers and must not be
    // resurrected.
    const attemptNumber = step.attempts + 1
    const findOrCreateExecution = () => findOrCreateRunningExecution(stepId, attemptNumber)

    // Cost/turns ride the daemon's 'claude run metadata' json artifact
    // (mini-services/conductor-daemon/evidence.ts). Lift total_cost_usd into
    // StepExecution.cost — the artifact stays for evidence.
    const claudeMetadataCost = (): number | undefined => {
      const meta = parsedArtifacts.find(a => a.label === 'claude run metadata')?.metadata as
        | Record<string, unknown>
        | undefined
      const cost = meta?.totalCostUsd
      return typeof cost === 'number' ? cost : undefined
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

      // G1-1-T4: finalize the StepExecution row with the recorded cost (TD-018b).
      const execution = await findOrCreateExecution()
      await succeedExecution(
        execution.id,
        output?.slice(0, MAX_OUTPUT_CHARS) ?? '',
        undefined,
        claudeMetadataCost(),
      )

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
      // Evidence first — a failed run's git diff is exactly what a reviewer needs,
      // and it must survive whatever the Finalizer decides.
      await persistArtifacts()

      // Daemon-specific event for the runtime dashboard's live log. `willRetry`
      // is echoed as the daemon's *hint* — the actual decision is the server's.
      broadcastProjectEvent(step.task.projectId, 'daemon-step-failed', {
        stepId,
        taskId: step.taskId,
        daemonId: daemon.id,
        error: errorMsg?.slice(0, 500),
        willRetry,
      })

      // G1-1-T2: route the daemon fail path through the same Finalizer the HTTP
      // path uses (ADR-0008). The SERVER decides retry vs terminal from the
      // step's own maxRetries/backoff — the daemon-supplied `willRetry` is a hint
      // we log, never obey (the reference daemon hardcodes willRetry:false, which
      // would otherwise make every daemon failure single-attempt and terminal).
      // Exhaustion now dead-letters + notifies exactly like HTTP (closes TD-025).
      // G1-1-T4: finalize a real StepExecution row (failExecution) so the failed
      // attempt records against the budget too.
      const execution = await findOrCreateExecution()
      const outcome = await finalizeStepFailure({
        step,
        attemptNumber,
        executionId: execution.id,
        message: errorMsg?.slice(0, MAX_OUTPUT_CHARS) || 'Daemon reported failure',
        isTimeout: false,
        eventMeta: { source: 'daemon', daemonId: daemon.id, ...(sessionId ? { sessionId } : {}) },
      })
      log.info('daemon fail finalized', { stepId, attemptNumber, outcome, willRetryHint: willRetry })
    }

    return NextResponse.json({ status: 'ok', stepId, action })
})
