import { db } from '@/lib/db'
import { getAdapter } from '@/lib/server/adapters/registry'
import { resolvePrompt } from '@/lib/server/resolve-prompt'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { resolveMcpTools, executeMcpTool } from '@/lib/server/mcp-resolver'
import { createExecution, succeedExecution, failExecution, timeoutExecution } from '@/lib/server/execution-log'
import { resolveNextSteps, type StepEdge } from '@/lib/server/condition-evaluator'
import { randomBytes } from 'crypto'

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`

/**
 * Find the previous agent step for a given step, DAG-aware.
 * In DAG mode: walks prevSteps edges to find the nearest non-human ancestor.
 * In linear mode: finds the highest-order non-human step before this one.
 */
export async function findPreviousAgentStep(taskId: string, stepId: string) {
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    select: { id: true, order: true, mode: true, prevSteps: true, nextSteps: true, agentId: true },
    orderBy: { order: 'asc' },
  })

  const currentStep = allSteps.find(s => s.id === stepId)
  if (!currentStep) return null

  const isDag = hasDagEdges(allSteps)

  if (isDag) {
    // BFS backward through prevSteps to find the nearest agent step
    const prevIds: string[] = currentStep.prevSteps ? JSON.parse(currentStep.prevSteps) : []
    const visited = new Set<string>()
    const queue = [...prevIds]

    while (queue.length > 0) {
      const candidateId = queue.shift()!
      if (visited.has(candidateId)) continue
      visited.add(candidateId)

      const candidate = allSteps.find(s => s.id === candidateId)
      if (!candidate) continue

      if (candidate.mode !== 'human' && candidate.agentId) {
        return candidate
      }

      // Keep walking backward
      const ancestorIds: string[] = candidate.prevSteps ? JSON.parse(candidate.prevSteps) : []
      for (const aid of ancestorIds) {
        if (!visited.has(aid)) queue.push(aid)
      }
    }

    return null
  }

  // Linear mode: find highest-order non-human step before this one
  return allSteps
    .filter(s => s.order < currentStep.order && s.mode !== 'human')
    .sort((a, b) => b.order - a.order)[0] || null
}

/** Check if any step has DAG edges (nextSteps or prevSteps). */
function hasDagEdges(steps: Array<{ nextSteps?: string | null; prevSteps?: string | null }>): boolean {
  return steps.some(s => s.nextSteps || s.prevSteps)
}

async function leaseStep(stepId: string): Promise<boolean> {
  const result = await db.taskStep.updateMany({
    where: {
      id: stepId,
      status: 'active',
      OR: [
        { leasedBy: null },
        { leasedBy: WORKER_ID },
      ],
    },
    data: {
      leasedBy: WORKER_ID,
      leasedAt: new Date(),
    },
  })
  return result.count > 0
}

export async function dispatchStep(stepId: string) {
  const step = await db.taskStep.findUnique({
    where: { id: stepId },
    include: {
      task: true,
      agent: true,
    },
  })

  if (!step || !step.agent || step.status !== 'active') return

  const agent = step.agent
  if (agent.projectId !== step.task.projectId) {
    await failStep(stepId, step.task.projectId, 'Agent does not belong to this project')
    return
  }
  if (!agent.runtimeId) return

  const runtime = await db.projectRuntime.findUnique({
    where: { id: agent.runtimeId },
  })

  if (!runtime) {
    await failStep(stepId, step.task.projectId, 'Runtime not found')
    return
  }

  const adapter = getAdapter(runtime.adapter)
  if (!adapter || !adapter.available) {
    await failStep(stepId, step.task.projectId, `Adapter "${runtime.adapter}" not available`)
    return
  }

  const activeCount = await db.taskStep.count({
    where: { agentId: agent.id, status: 'active', id: { not: stepId } },
  })
  if (activeCount >= agent.maxConcurrent) {
    await db.taskStep.update({ where: { id: stepId }, data: { status: 'pending' } })
    return
  }

  // Find predecessor step: use prevSteps edges for DAG, order-1 for linear
  let previousStep: { output: string | null } | null = null
  if (step.prevSteps) {
    const prevIds: string[] = JSON.parse(step.prevSteps)
    if (prevIds.length > 0) {
      // Use the first predecessor's output (or concatenate all for multi-parent merge)
      const prevSteps = await db.taskStep.findMany({
        where: { id: { in: prevIds } },
        select: { output: true },
      })
      if (prevSteps.length === 1) {
        previousStep = prevSteps[0]
      } else if (prevSteps.length > 1) {
        // Merge point: combine outputs from all incoming branches
        const combinedOutput = prevSteps
          .filter(s => s.output)
          .map(s => s.output)
          .join('\n\n---\n\n')
        previousStep = { output: combinedOutput || null }
      }
    }
  } else {
    previousStep = await db.taskStep.findFirst({
      where: { taskId: step.taskId, order: step.order - 1 },
      select: { output: true },
    })
  }

  const projectMode = await db.projectMode.findFirst({
    where: { projectId: step.task.projectId, name: step.mode },
  })

  const agentModeInstructions = agent.modeInstructions
    ? JSON.parse(agent.modeInstructions)[step.mode]
    : null

  const modeInstructions = agentModeInstructions || projectMode?.instructions || ''

  const capabilities = agent.capabilities
    ? JSON.parse(agent.capabilities).join(', ')
    : ''

  const systemPrompt = resolvePrompt(agent.systemPrompt || '', {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities },
  })

  const taskContext = [
    `Task: ${step.task.title}`,
    step.task.description ? `Description: ${step.task.description}` : '',
    step.instructions ? `Step Instructions: ${step.instructions}` : '',
  ].filter(Boolean).join('\n\n')

  const rejectionContext = step.rejectionNote
    ? `\n\nHUMAN FEEDBACK (from previous attempt #${step.attempts}):\n${step.rejectionNote}\n\nPlease address this feedback in your revised response.`
    : ''

  const fullTaskContext = taskContext + rejectionContext

  const mcpConnectionIds = agent.mcpConnectionIds
    ? JSON.parse(agent.mcpConnectionIds)
    : []

  const tools = await resolveMcpTools(mcpConnectionIds, step.mode)

  const runtimeConfig: Record<string, unknown> = {
    ...(runtime.config ? JSON.parse(runtime.config) : {}),
    apiKeyEnvVar: runtime.apiKeyEnvVar,
    endpoint: runtime.endpoint,
  }

  // Lease the step for idempotent execution
  const leased = await leaseStep(stepId)
  if (!leased) return

  // Determine attempt number
  const previousExecutions = await db.stepExecution.count({ where: { stepId } })
  const attemptNumber = previousExecutions + 1

  const execution = await createExecution(stepId, attemptNumber)

  if (attemptNumber === 1) {
    await db.taskStep.updateMany({
      where: { id: stepId, status: 'active' },
      data: { startedAt: new Date() },
    })
  }

  const timeoutMs = step.timeoutMs || 300000

  try {
    const result = await Promise.race([
      adapter.dispatch({
        systemPrompt,
        taskContext: fullTaskContext,
        previousOutput: previousStep?.output || undefined,
        mode: step.mode,
        model: agent.runtimeModel || 'default',
        runtimeConfig,
        tools: tools.length > 0 ? tools : undefined,
        mcpConnectionIds: mcpConnectionIds.length > 0 ? mcpConnectionIds : undefined,
        executionId: execution.id,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('STEP_TIMEOUT')), timeoutMs)
      ),
    ])

    await succeedExecution(execution.id, result.output, result.tokensUsed)

    await db.taskStep.update({
      where: { id: stepId },
      data: {
        status: 'done',
        output: result.output,
        attempts: attemptNumber,
        completedAt: new Date(),
        leasedBy: null,
        leasedAt: null,
      },
    })

    // Save MCP artifacts if any were collected during tool use
    if (result.artifacts && result.artifacts.length > 0) {
      for (const artifact of result.artifacts) {
        await db.stepArtifact.create({
          data: {
            stepId,
            executionId: execution.id,
            type: artifact.type,
            label: artifact.label,
            content: artifact.content || null,
            url: artifact.url || null,
            mimeType: artifact.mimeType || null,
          },
        })
      }
    }

    await broadcastProjectEvent(step.task.projectId, 'step-completed', {
      taskId: step.taskId,
      stepId,
      output: result.output,
      attempt: attemptNumber,
      tokensUsed: result.tokensUsed,
    })

    await advanceChain(step.taskId, step.task.projectId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error'
    const isTimeout = message === 'STEP_TIMEOUT'

    if (isTimeout) {
      await timeoutExecution(execution.id)
    } else {
      await failExecution(execution.id, message)
    }

    const maxRetries = step.maxRetries ?? 2
    const retryDelayMs = step.retryDelayMs ?? 5000

    if (attemptNumber < maxRetries + 1) {
      // Retry: keep step active, schedule for re-pickup
      await db.taskStep.update({
        where: { id: stepId },
        data: {
          attempts: attemptNumber,
          leasedBy: null,
          leasedAt: retryDelayMs > 0 ? new Date(Date.now() + retryDelayMs) : null,
        },
      })

      await broadcastProjectEvent(step.task.projectId, 'step-retrying', {
        taskId: step.taskId,
        stepId,
        attempt: attemptNumber,
        maxRetries,
        error: message,
      })
    } else {
      // Exhausted retries — check for fallback agent before dead-lettering
      if (step.fallbackAgentId && step.fallbackAgentId !== step.agentId) {
        // Switch to fallback agent and reset for another attempt cycle
        await db.taskStep.update({
          where: { id: stepId },
          data: {
            agentId: step.fallbackAgentId,
            status: 'active',
            error: null,
            attempts: 0,
            leasedBy: null,
            leasedAt: null,
          },
        })

        await broadcastProjectEvent(step.task.projectId, 'step-fallback', {
          taskId: step.taskId,
          stepId,
          fromAgentId: step.agentId,
          toAgentId: step.fallbackAgentId,
          reason: message,
        })
        // Step is active with new agent — the queue will pick it up
      } else {
        // No fallback — dead-letter
        await db.taskStep.update({
          where: { id: stepId },
          data: {
            status: 'failed',
            error: `Failed after ${attemptNumber} attempts. Last error: ${message}`,
            attempts: attemptNumber,
            completedAt: new Date(),
            leasedBy: null,
            leasedAt: null,
          },
        })

        await broadcastProjectEvent(step.task.projectId, 'step-failed', {
          taskId: step.taskId,
          stepId,
          error: message,
          attempt: attemptNumber,
          exhaustedRetries: true,
        })

        await db.task.update({
          where: { id: step.taskId },
          data: { status: 'WAITING' },
        })
      }
    }
  }
}

async function failStep(stepId: string, projectId: string, error: string) {
  const step = await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'failed', error, completedAt: new Date(), leasedBy: null, leasedAt: null },
  })

  await db.task.update({
    where: { id: step.taskId },
    data: { status: 'WAITING' },
  })

  await broadcastProjectEvent(projectId, 'step-failed', {
    taskId: step.taskId,
    stepId,
    error,
  })
}

export async function advanceChain(taskId: string, projectId: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    orderBy: { order: 'asc' },
    include: { agent: true },
  })

  const lastDoneStep = [...steps].reverse().find((s) => s.status === 'done' || s.status === 'skipped')
  if (!lastDoneStep) return

  // Check if this is a DAG chain (any step has nextSteps) or linear
  const isDag = hasDagEdges(steps)

  if (isDag) {
    await advanceChainDag(taskId, projectId, steps, lastDoneStep)
  } else {
    await advanceChainLinear(taskId, projectId, steps, lastDoneStep)
  }
}

type StepWithAgent = Awaited<ReturnType<typeof db.taskStep.findMany<{ include: { agent: true } }>>>[number]

async function advanceChainLinear(
  taskId: string,
  projectId: string,
  steps: StepWithAgent[],
  lastDoneStep: StepWithAgent,
) {
  const nextStep = steps.find((s) => s.order === lastDoneStep.order + 1)

  if (!nextStep) {
    await db.task.update({
      where: { id: taskId },
      data: { status: 'DONE', completedAt: new Date() },
    })
    await broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    return
  }

  if (!lastDoneStep.autoContinue) {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  await activateStep(taskId, projectId, nextStep, lastDoneStep.id)
  await resolveTaskStatus(taskId, projectId)
}

async function advanceChainDag(
  taskId: string,
  projectId: string,
  steps: StepWithAgent[],
  completedStep: StepWithAgent,
) {
  // Parse edges from the completed step
  const edges: StepEdge[] = completedStep.nextSteps
    ? JSON.parse(completedStep.nextSteps)
    : []

  if (edges.length === 0) {
    // No outgoing edges — check if ALL steps are done/skipped (chain complete)
    const allDone = steps.every(s => s.status === 'done' || s.status === 'skipped')
    if (allDone) {
      await db.task.update({
        where: { id: taskId },
        data: { status: 'DONE', completedAt: new Date() },
      })
      await broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    }
    return
  }

  if (!completedStep.autoContinue) {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  // Get the latest execution for condition context
  const latestExecution = await db.stepExecution.findFirst({
    where: { stepId: completedStep.id },
    orderBy: { attempt: 'desc' },
  })

  // Build context for condition evaluation
  const context = {
    output: completedStep.output,
    status: completedStep.status,
    tokensUsed: latestExecution?.tokensUsed ?? null,
    error: completedStep.error,
  }

  // Resolve which next steps to activate
  const targetStepIds = resolveNextSteps(edges, context)

  if (targetStepIds.length === 0) {
    // No conditions matched and no default path — chain is stuck
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  // Activate each target step (parallel branching if multiple)
  for (const targetStepId of targetStepIds) {
    const targetStep = steps.find(s => s.id === targetStepId)
    if (!targetStep) continue

    // If target is a merge point, check that ALL its prevSteps are done
    if (targetStep.isMergePoint && targetStep.prevSteps) {
      const prevStepIds: string[] = JSON.parse(targetStep.prevSteps)
      const allPrevDone = prevStepIds.every(prevId => {
        const prevStep = steps.find(s => s.id === prevId)
        return prevStep && (prevStep.status === 'done' || prevStep.status === 'skipped')
      })

      if (!allPrevDone) {
        // Not all incoming branches are done yet — skip activation
        continue
      }
    }

    await activateStep(taskId, projectId, targetStep, completedStep.id)
  }

  // Resolve task status after all activations
  await resolveTaskStatus(taskId, projectId)
}

async function activateStep(
  taskId: string,
  projectId: string,
  step: StepWithAgent,
  fromStepId: string,
) {
  const activated = await db.taskStep.updateMany({
    where: { id: step.id, status: 'pending' },
    data: { status: 'active' },
  })
  if (activated.count === 0) return // another caller already activated it

  await broadcastProjectEvent(projectId, 'step-activated', {
    taskId,
    stepId: step.id,
  })

  await broadcastProjectEvent(projectId, 'chain-advanced', {
    taskId,
    fromStepId,
    toStepId: step.id,
  })

  // Don't set task status here — let the caller resolve it after all activations
}

/**
 * Compute the correct task status from its steps.
 * - Any active agent step with a runtime → IN_PROGRESS
 * - Only human/no-runtime active steps → WAITING
 * - All done/skipped → DONE
 */
async function resolveTaskStatus(taskId: string, projectId: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    select: { status: true, mode: true, agent: { select: { runtimeId: true } } },
  })

  const allDone = steps.every(s => s.status === 'done' || s.status === 'skipped')
  if (allDone) {
    await db.task.update({
      where: { id: taskId },
      data: { status: 'DONE', completedAt: new Date() },
    })
    await broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    return
  }

  const hasActiveAgentStep = steps.some(
    s => s.status === 'active' && s.mode !== 'human' && s.agent?.runtimeId
  )

  if (hasActiveAgentStep) {
    await db.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
  } else {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
  }
}

export async function rewindChain(
  taskId: string,
  projectId: string,
  targetStepId: string,
  rejectionNote: string,
) {
  const targetStep = await db.taskStep.findUnique({
    where: { id: targetStepId },
    include: { agent: true },
  })

  if (!targetStep) throw new Error('Target step not found')

  await db.taskStep.update({
    where: { id: targetStepId },
    data: {
      status: 'active',
      output: null,
      error: null,
      rejectionNote,
      attempts: { increment: 1 },
      startedAt: null,
      completedAt: null,
    },
  })

  // Reset downstream steps. In DAG mode, find all steps reachable from
  // the target via nextSteps edges. In linear mode, use order > target.
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    select: { id: true, order: true, nextSteps: true, prevSteps: true, isMergePoint: true },
  })

  const isDag = hasDagEdges(allSteps)

  let resetIds: string[]
  if (isDag) {
    const visited = new Set<string>()
    visited.add(targetStepId) // seed with target to prevent cycles

    // Forward BFS: find all downstream steps reachable via nextSteps
    const forwardQueue = [targetStepId]
    while (forwardQueue.length > 0) {
      const current = forwardQueue.shift()!
      const step = allSteps.find(s => s.id === current)
      if (!step?.nextSteps) continue
      const edges: Array<{ targetStepId: string }> = JSON.parse(step.nextSteps)
      for (const edge of edges) {
        if (!visited.has(edge.targetStepId)) {
          visited.add(edge.targetStepId)
          forwardQueue.push(edge.targetStepId)
        }
      }
    }

    // If the target step is a merge point, also reset its sibling branches
    // (steps that feed into it via prevSteps) so they re-execute
    const target = allSteps.find(s => s.id === targetStepId)
    if (target?.isMergePoint && target.prevSteps) {
      const prevIds: string[] = JSON.parse(target.prevSteps)
      // Reverse BFS: walk backward from each prevStep to find all ancestor steps
      const reverseQueue = [...prevIds]
      for (const pid of reverseQueue) {
        if (!visited.has(pid)) visited.add(pid)
      }
      while (reverseQueue.length > 0) {
        const current = reverseQueue.shift()!
        const step = allSteps.find(s => s.id === current)
        if (!step?.prevSteps) continue
        const ancestors: string[] = JSON.parse(step.prevSteps)
        for (const ancestorId of ancestors) {
          if (!visited.has(ancestorId)) {
            visited.add(ancestorId)
            reverseQueue.push(ancestorId)
          }
        }
      }
    }

    // Remove the target step itself from the reset list (it's handled separately above)
    visited.delete(targetStepId)
    resetIds = Array.from(visited)
  } else {
    resetIds = allSteps
      .filter(s => s.order > targetStep.order)
      .map(s => s.id)
  }

  if (resetIds.length > 0) {
    await db.taskStep.updateMany({
      where: { id: { in: resetIds } },

  if (downstreamIds.length > 0) {
    await db.taskStep.updateMany({
      where: { id: { in: downstreamIds } },
      data: {
        status: 'pending',
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      },
    })
  }

  await db.task.update({
    where: { id: taskId },
    data: { status: 'IN_PROGRESS' },
  })

  await broadcastProjectEvent(projectId, 'chain-rewound', {
    taskId,
    targetStepId,
    rejectionNote,
  })

  // Step is active — the queue will pick it up on next poll
}

export async function closeChain(taskId: string, projectId: string, note: string) {
  await db.taskStep.updateMany({
    where: {
      taskId,
      status: { in: ['pending', 'active'] },
    },
    data: { status: 'skipped' },
  })

  await db.task.update({
    where: { id: taskId },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      output: `Chain closed: ${note}`,
    },
  })

  await broadcastProjectEvent(projectId, 'chain-completed', { taskId, closed: true, note })
}

export async function startChain(taskId: string, projectId: string) {
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    include: { agent: true },
    orderBy: { order: 'asc' },
  })

  if (allSteps.length === 0) return

  // Check if this is a DAG chain
  const isDag = hasDagEdges(allSteps)

  // Find root steps: in DAG mode = steps with no prevSteps; in linear mode = order 1
  const rootSteps = isDag
    ? allSteps.filter(s => {
        const prev = s.prevSteps ? JSON.parse(s.prevSteps) as string[] : []
        return prev.length === 0
      })
    : allSteps.filter(s => s.order === 1)

  if (rootSteps.length === 0) return

  for (const rootStep of rootSteps) {
    const activated = await db.taskStep.updateMany({
      where: { id: rootStep.id, status: 'pending' },
      data: { status: 'active' },
    })
    if (activated.count === 0) continue

    await broadcastProjectEvent(projectId, 'step-activated', {
      taskId,
      stepId: rootStep.id,
    })
  }

  // Resolve task status after all root activations
  await resolveTaskStatus(taskId, projectId)
}
