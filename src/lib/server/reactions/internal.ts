// Internal reaction types (Epic S7 Phase 1): automation actions that mutate
// Conductor state instead of posting to external services. They run on the
// same Trigger/Reaction pipeline as the outbound types — same filters, same
// ordering, same failure tracking.
//
// SAFETY RAILS (non-negotiable, see the S7 design doc):
// 1. No cascades — these mutate via `db` directly and NEVER call
//    fireProjectEvent, so an automation can never trigger another automation.
// 2. Idempotence — every action no-ops cleanly ({skipped: ...}) when the
//    target is already in the desired state, so re-fired events are harmless.
// 3. Audit — every real mutation writes an automation_rule_fired activity row.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('reactions/internal')

export interface InternalReactionContext {
  projectId: string
  taskId?: string
  stepId?: string
}

type Output = Record<string, unknown>

const PRIORITY_LADDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
type Priority = (typeof PRIORITY_LADDER)[number]

function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITY_LADDER as readonly string[]).includes(value)
}

async function logRuleFired(
  ctx: InternalReactionContext,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db.activityLog.create({
    data: {
      action: 'automation_rule_fired',
      level: 'info',
      component: 'automation',
      projectId: ctx.projectId,
      taskId: ctx.taskId ?? null,
      details: JSON.stringify({ ruleAction: action, ...details }),
    },
  }).catch((err) => log.warn('failed to write automation audit row', { err: String(err) }))
}

/** Loads the context task and verifies it belongs to the trigger's project. */
async function requireTask(ctx: InternalReactionContext) {
  if (!ctx.taskId) {
    throw new Error('This internal action needs a taskId in the event payload')
  }
  const task = await db.task.findUnique({
    where: { id: ctx.taskId },
    select: { id: true, projectId: true, agentId: true, priority: true, status: true, archivedAt: true },
  })
  if (!task || task.projectId !== ctx.projectId) {
    throw new Error('Task not found in this project')
  }
  return task
}

/** task:assign — { agentId } or { agentRole }, optional { force }. */
export async function executeTaskAssign(
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output> {
  const task = await requireTask(ctx)

  if (task.agentId && config.force !== true) {
    return { skipped: 'task already has an agent' }
  }

  let agent: { id: string; name: string } | null = null
  if (typeof config.agentId === 'string' && config.agentId) {
    agent = await db.agent.findFirst({
      where: { id: config.agentId, projectId: ctx.projectId },
      select: { id: true, name: true },
    })
  } else if (typeof config.agentRole === 'string' && config.agentRole) {
    agent = await db.agent.findFirst({
      where: { projectId: ctx.projectId, role: config.agentRole },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    })
  } else {
    throw new Error('task:assign needs an agentId or agentRole in its config')
  }

  if (!agent) {
    throw new Error('task:assign found no matching agent in this project')
  }
  if (task.agentId === agent.id) {
    return { skipped: 'task already assigned to this agent' }
  }

  await db.task.update({ where: { id: task.id }, data: { agentId: agent.id } })
  await logRuleFired(ctx, 'task:assign', { agentId: agent.id, agentName: agent.name })
  return { assigned: agent.id, agentName: agent.name }
}

/** task:set-priority — { priority }. */
export async function executeTaskSetPriority(
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output> {
  if (!isPriority(config.priority)) {
    throw new Error('task:set-priority needs a priority of LOW | MEDIUM | HIGH | URGENT')
  }
  const task = await requireTask(ctx)

  if (task.priority === config.priority) {
    return { skipped: 'task already has this priority' }
  }

  await db.task.update({ where: { id: task.id }, data: { priority: config.priority } })
  await logRuleFired(ctx, 'task:set-priority', { from: task.priority, to: config.priority })
  return { priority: config.priority, was: task.priority }
}

/** task:set-retry — { maxRetries, retryDelayMs? }; touches PENDING steps only. */
export async function executeTaskSetRetry(
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output> {
  const maxRetries = config.maxRetries
  if (typeof maxRetries !== 'number' || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 20) {
    throw new Error('task:set-retry needs an integer maxRetries between 0 and 20')
  }
  const retryDelayMs = config.retryDelayMs
  if (retryDelayMs !== undefined && (typeof retryDelayMs !== 'number' || retryDelayMs < 0)) {
    throw new Error('task:set-retry retryDelayMs must be a non-negative number')
  }
  const task = await requireTask(ctx)

  // Running/completed attempts keep their history — only steps that haven't
  // started yet get the new policy.
  const result = await db.taskStep.updateMany({
    where: { taskId: task.id, status: 'pending' },
    data: {
      maxRetries,
      ...(retryDelayMs !== undefined ? { retryDelayMs } : {}),
    },
  })

  if (result.count === 0) {
    return { skipped: 'no pending steps to update' }
  }
  await logRuleFired(ctx, 'task:set-retry', { maxRetries, retryDelayMs, stepsUpdated: result.count })
  return { stepsUpdated: result.count, maxRetries }
}

/** task:archive — DONE tasks only; archived means kept, out of the way. */
export async function executeTaskArchive(
  _config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output> {
  const task = await requireTask(ctx)

  if (task.archivedAt) {
    return { skipped: 'task already archived' }
  }
  if (task.status !== 'DONE') {
    // An automation must never archive live work — skip, don't error, so a
    // broad trigger doesn't rack up failures on in-flight tasks.
    return { skipped: `task is ${task.status}, only DONE tasks archive` }
  }

  await db.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } })
  await logRuleFired(ctx, 'task:archive', {})
  return { archived: true }
}

/** step:escalate — { bumpPriority?, reassignFallback? } on the payload's step. */
export async function executeStepEscalate(
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output> {
  const bumpPriority = config.bumpPriority === true
  const reassignFallback = config.reassignFallback === true
  if (!bumpPriority && !reassignFallback) {
    throw new Error('step:escalate needs bumpPriority and/or reassignFallback set to true')
  }

  const output: Output = {}

  if (bumpPriority) {
    const task = await requireTask(ctx)
    const index = PRIORITY_LADDER.indexOf(task.priority as Priority)
    if (index === -1 || index === PRIORITY_LADDER.length - 1) {
      output.priority = { skipped: 'already at URGENT' }
    } else {
      const next = PRIORITY_LADDER[index + 1]
      await db.task.update({ where: { id: task.id }, data: { priority: next } })
      await logRuleFired(ctx, 'step:escalate', { bumpedPriority: next, from: task.priority })
      output.priority = { bumped: next }
    }
  }

  if (reassignFallback) {
    if (!ctx.stepId) {
      throw new Error('step:escalate reassignFallback needs a stepId in the event payload')
    }
    const step = await db.taskStep.findUnique({
      where: { id: ctx.stepId },
      select: { id: true, agentId: true, fallbackAgentId: true, task: { select: { projectId: true } } },
    })
    if (!step || step.task.projectId !== ctx.projectId) {
      throw new Error('Step not found in this project')
    }
    if (!step.fallbackAgentId) {
      output.reassign = { skipped: 'step has no fallback agent' }
    } else if (step.agentId === step.fallbackAgentId) {
      output.reassign = { skipped: 'step already on its fallback agent' }
    } else {
      await db.taskStep.update({
        where: { id: step.id },
        data: { agentId: step.fallbackAgentId },
      })
      await logRuleFired(ctx, 'step:escalate', { stepId: step.id, reassignedTo: step.fallbackAgentId })
      output.reassign = { reassignedTo: step.fallbackAgentId }
    }
  }

  return output
}

export async function dispatchInternalReaction(
  type: string,
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<Output | null> {
  switch (type) {
    case 'task:assign':       return executeTaskAssign(config, ctx)
    case 'task:set-priority': return executeTaskSetPriority(config, ctx)
    case 'task:set-retry':    return executeTaskSetRetry(config, ctx)
    case 'task:archive':      return executeTaskArchive(config, ctx)
    case 'step:escalate':     return executeStepEscalate(config, ctx)
    default: return null // not an internal type
  }
}
