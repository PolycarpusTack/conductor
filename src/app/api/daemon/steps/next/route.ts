import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { resolveRuntime } from '@/lib/server/daemon-dispatch'
import { parseSessionPolicy, sessionKeyForStep, resolveCommandTemplate } from '@/lib/server/session-policy'
import { appendStepEvent } from '@/lib/server/step-events'

/**
 * Daemon polling endpoint. Returns the oldest `active` step that has been
 * leased to the calling daemon — or `{ step: null }` if nothing is ready.
 *
 * A step is leased by `pollAndDispatch` in step-queue when its agent has
 * `invocationMode = 'DAEMON'`. The daemon runs the step locally (CLI tools,
 * local files) and reports back via POST /api/daemon/steps.
 *
 * The `step` object is the daemon's Execution Payload (payloadVersion 1) —
 * its shape is contract-tested against the daemon runner's
 * `validateExecutionPayload` and documented in
 * docs/gpm/state/snapshots/daemon-execution-payload.md. Bump `payloadVersion`
 * on any breaking change.
 *
 * Also refreshes the daemon's heartbeat.
 */

/**
 * Tokens a commandTemplate may reference — server-owned scalars only, never
 * user/LLM prose (A-1 AC 3: unknown tokens are rejected loudly, not silently
 * resolved to empty strings — one dropped token would run a mangled command).
 */
const COMMAND_TEMPLATE_TOKENS = new Set(['agent.runtimeModel', 'task.id', 'step.id', 'step.mode'])

function unknownTemplateTokens(template: string | null | undefined): string[] {
  if (!template) return []
  const unknown: string[] = []
  for (const match of template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
    if (!COMMAND_TEMPLATE_TOKENS.has(match[1])) unknown.push(match[1])
  }
  return unknown
}
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
        traceContext: true,
        leasedAt: true,
        agent: {
          select: {
            id: true,
            name: true,
            systemPrompt: true,
            modeInstructions: true,
            mcpConnectionIds: true,
            runtimeModel: true,
            runtime: { select: { adapter: true, config: true } },
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

    // Session policy from the agent's runtime config; the sessionKey is
    // computed server-side so reuse semantics live in one place.
    const policy = parseSessionPolicy(step.agent?.runtime?.config)
    const badTokens = unknownTemplateTokens(policy.commandTemplate)
    const session = {
      policy: policy.sessionPolicy,
      backend: policy.sessionBackend,
      sessionKey: sessionKeyForStep(policy, {
        agentId: step.agentId,
        taskId: step.taskId,
        stepId: step.id,
      }),
      command:
        badTokens.length > 0
          ? null
          : resolveCommandTemplate(policy.commandTemplate, {
              'agent.runtimeModel': step.agent?.runtimeModel,
              'task.id': step.taskId,
              'step.id': step.id,
              'step.mode': step.mode,
            }),
      // Loud rejection — the daemon fails the step with this message instead
      // of executing a command with silently-dropped tokens.
      commandError:
        badTokens.length > 0
          ? `commandTemplate references unknown tokens: ${badTokens.join(', ')} (allowed: ${[...COMMAND_TEMPLATE_TOKENS].join(', ')})`
          : null,
      workingDirectoryPolicy: policy.workingDirectoryPolicy,
      idleRequiredBeforeCommand: policy.idleRequiredBeforeCommand,
      maxOutputPreviewChars: policy.maxOutputPreviewChars,
    }

    // First audit-trail entry on the daemon path (parity with HTTP dispatch).
    // The daemon re-polls the same leased step until it completes — dedupe by
    // only emitting once per lease (no started event newer than the lease).
    const alreadyStarted = await db.stepEvent.findFirst({
      where: {
        stepId: step.id,
        event: 'started',
        ...(step.leasedAt ? { createdAt: { gte: step.leasedAt } } : {}),
      },
      select: { id: true },
    })
    if (!alreadyStarted) {
      await appendStepEvent(step.id, 'started', {
        source: 'daemon',
        daemonId: daemon.id,
        attempt: step.attempts + 1,
      })
    }

    return NextResponse.json({
      step: {
        payloadVersion: 1,
        id: step.id,
        taskId: step.taskId,
        order: step.order,
        mode: step.mode,
        instructions: step.instructions,
        timeoutMs: step.timeoutMs,
        retryDelayMs: step.retryDelayMs,
        maxRetries: step.maxRetries,
        attempt: step.attempts + 1,
        // W3C carrier from the request that created the step — lets the
        // daemon continue the trace across the process boundary.
        traceContext: step.traceContext,
        runtime,
        session,
        agent: step.agent
          ? {
              id: step.agent.id,
              name: step.agent.name,
              systemPrompt: step.agent.systemPrompt,
              modeInstructions: step.agent.modeInstructions,
              mcpConnectionIds: step.agent.mcpConnectionIds,
              runtimeModel: step.agent.runtimeModel,
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
