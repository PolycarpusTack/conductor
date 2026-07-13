import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractDaemonToken, resolveDaemonByToken, updateDaemonHeartbeat } from '@/lib/server/daemon-auth'
import { resolveRuntime } from '@/lib/server/daemon-dispatch'
import { buildDaemonMcpServers } from '@/lib/server/daemon-mcp-config'
import { buildResolvedPrompt } from '@/lib/server/dispatch'
import { findOrCreateRunningExecution } from '@/lib/server/execution-log'
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
        prevSteps: true,
        rejectionNote: true,
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
            role: true,
            capabilities: true,
            personality: true,
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

    // G1-1-T3: resolve the prompt server-side so the daemon never receives a
    // literal `{{task.title}}`/`{{memory.recent}}` token (gap 1.1), and hand it
    // the previous step's output for chain context (gap 1.2). Uses the same
    // buildResolvedPrompt the HTTP path uses — identical resolution.
    const resolved = step.agent ? await buildResolvedPrompt(step, step.agent) : null

    // G1-3 (gap 1.6): sanitized MCP servers for the claude runner — URLs +
    // header templates with ${ENV_VAR} references only, never secret values
    // (env indirection, spike G1-3-T0). Project-scoped lookup.
    const mcp = await buildDaemonMcpServers(step.agent?.mcpConnectionIds, step.task.projectId)

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

      // G1-1-T4: create the StepExecution row for this attempt so the daemon
      // path records cost and binds budgets like the HTTP path (closes TD-018b).
      // Deduped by the same started-once-per-lease guard plus a belt-and-braces
      // still-running check. G1-4: allocated past the highest existing attempt,
      // never looked up by attempt number — after a fallback escalation resets
      // `attempts`, the failed agent's terminal rows occupy the low numbers and
      // must not be resurrected. startedAt on the first attempt = parity with
      // executeDispatch (closes the startedAt part of gap 1.7).
      await findOrCreateRunningExecution(step.id, step.attempts + 1)
      if (step.attempts === 0) {
        await db.taskStep.updateMany({
          where: { id: step.id, status: 'active' },
          data: { startedAt: new Date() },
        })
      }
    }

    return NextResponse.json({
      step: {
        payloadVersion: 2,
        id: step.id,
        taskId: step.taskId,
        order: step.order,
        mode: step.mode,
        // Instructions and the agent system prompt are RESOLVED server-side
        // (v2): the daemon spawns the CLI with real text, never `{{tokens}}`.
        instructions: resolved ? resolved.resolvedInstructions : step.instructions,
        // Previous step's output — chain context, parity with the HTTP path.
        previousOutput: resolved?.previousStep?.output ?? null,
        // G1-2: reviewer's rejection note (raw human text, like the HTTP path)
        // so a rewound daemon step can actually address the feedback (gap 1.3).
        rejectionNote: step.rejectionNote ?? null,
        // G1-4 (gap 1.7): the SERVER-LAYERED mode instructions for this step's
        // mode — agent-mode override || projectMode.instructions, plus the
        // output-format hint — exactly the layer buildResolvedPrompt computes
        // for the HTTP path. The daemon prefers this over its legacy parse of
        // agent.modeInstructions (which never carried the projectMode layer).
        modeInstructions: resolved?.modeInstructions || null,
        // G1-3 (gap 1.6): MCP servers for the spawned CLI (claude runner).
        // `mcp.configError` set → the daemon fails the step, never spawns
        // (same contract as session.commandError — no silent pretend).
        mcp,
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
              systemPrompt: resolved ? resolved.systemPrompt : step.agent.systemPrompt,
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
