import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { resolveRuntime } from '@/lib/server/daemon-dispatch'

/**
 * Daemon polling endpoint. Returns the oldest `active` step that has been
 * leased to the calling daemon — or `{ step: null }` if nothing is ready.
 *
 * A step is leased by `pollAndDispatch` in step-queue when its agent has
 * `invocationMode = 'DAEMON'`. The daemon runs the step locally (CLI tools,
 * local files) and reports back via POST /api/daemon/steps.
 *
 * Also refreshes the daemon's heartbeat.
 */
export const GET = withErrorHandling('api/daemon/steps/next', async (request: Request) => {
  const rawToken = extractDaemonToken(request)
  if (!rawToken) throw unauthorized('Missing daemon token')

  const daemon = await resolveDaemonByToken(rawToken)
  if (!daemon) throw unauthorized('Invalid daemon token')

  await updateDaemonHeartbeat(daemon.id)

    const step = await db.taskStep.findFirst({
      where: {
        leasedBy: daemon.id,
        status: 'active',
      },
      orderBy: { leasedAt: 'asc' },
      select: {
        id: true,
        taskId: true,
        order: true,
        mode: true,
        instructions: true,
        timeoutMs: true,
        retryDelayMs: true,
        maxRetries: true,
        attempts: true,
        agentId: true,
        agent: {
          select: {
            id: true,
            name: true,
            systemPrompt: true,
            modeInstructions: true,
            mcpConnectionIds: true,
            runtime: { select: { adapter: true } },
          },
        },
        task: {
          select: {
            id: true,
            title: true,
            description: true,
            projectId: true,
            runtimeOverride: true,
          },
        },
      },
    })

    if (!step) {
      return NextResponse.json({ step: null })
    }

    const runtime = await resolveRuntime(step.taskId, step.agent?.runtime?.adapter)

    return NextResponse.json({
      step: {
        id: step.id,
        taskId: step.taskId,
        order: step.order,
        mode: step.mode,
        instructions: step.instructions,
        timeoutMs: step.timeoutMs,
        retryDelayMs: step.retryDelayMs,
        maxRetries: step.maxRetries,
        attempt: step.attempts + 1,
        runtime,
        agent: step.agent
          ? {
              id: step.agent.id,
              name: step.agent.name,
              systemPrompt: step.agent.systemPrompt,
              modeInstructions: step.agent.modeInstructions,
              mcpConnectionIds: step.agent.mcpConnectionIds,
            }
          : null,
        task: {
          id: step.task.id,
          title: step.task.title,
          description: step.task.description,
          projectId: step.task.projectId,
        },
      },
    })
})
