import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { startChain } from '@/lib/server/dispatch'
import { taskBoardInclude } from '@/lib/server/selects'

const log = getLogger('agent-helpers')

type AgentRef = { id: string; name: string; emoji: string; projectId: string }

const HEARTBEAT_DEBOUNCE_MS = 30_000
const heartbeatCache = new Map<string, number>()

/** Claim Lease window (B-2): default 15 min, overridable via env. */
export const DEFAULT_CLAIM_LEASE_MS = 15 * 60_000

/**
 * Read the Model-B claim-lease window. Optional env override, validated at
 * boot by env.ts (AGENTBOARD_CLAIM_LEASE_MS); read at call time so tests and
 * runtime reconfiguration see the current value.
 */
export function getClaimLeaseMs(): number {
  const raw = Number(process.env.AGENTBOARD_CLAIM_LEASE_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLAIM_LEASE_MS
}

/** Test hook: clears the heartbeat debounce cache (module-level state). */
export function resetHeartbeatDebounce() {
  heartbeatCache.clear()
}

/**
 * Updates agent lastSeen/isActive in DB, debounced to at most once per 30s per agent.
 * Returns true if a DB write was performed, false if skipped due to debounce.
 *
 * Riding the same debounced write (B-2): any authenticated agent activity
 * renews the claim lease on the tasks THIS agent has claimed. Dispatcher
 * -driven tasks (claimExpiresAt null) are never touched.
 */
export async function updateAgentHeartbeat(agentId: string): Promise<boolean> {
  const now = Date.now()
  const lastWrite = heartbeatCache.get(agentId) ?? 0

  if (now - lastWrite < HEARTBEAT_DEBOUNCE_MS) {
    return false // skip — recently written
  }

  heartbeatCache.set(agentId, now)

  await db.agent.update({
    where: { id: agentId },
    data: { lastSeen: new Date(), isActive: true },
  })

  await db.task.updateMany({
    where: {
      agentId,
      status: 'IN_PROGRESS',
      claimExpiresAt: { not: null },
    },
    data: { claimExpiresAt: new Date(now + getClaimLeaseMs()) },
  })

  return true
}

export function toRealtimeActivity(args: {
  action: string
  agent: { id: string; name: string; emoji: string }
  details?: string
  taskId?: string
}) {
  return {
    id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action: args.action,
    taskId: args.taskId,
    agentId: args.agent.id,
    agent: {
      name: args.agent.name,
      emoji: args.agent.emoji,
    },
    details: args.details,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Atomically claim or start a task for an agent.
 * Returns `{ task }` on success, `{ error, status }` on failure.
 */
export async function claimOrStartTask(
  taskId: string,
  agent: AgentRef,
  action: 'claimed' | 'started',
  details?: string,
) {
  const existingTask = await db.task.findUnique({ where: { id: taskId } })

  if (!existingTask || existingTask.projectId !== agent.projectId) {
    return { error: 'Task not found', status: 404 as const }
  }

  const result = await db.task.updateMany({
    where: {
      id: taskId,
      projectId: agent.projectId,
      status: { in: ['BACKLOG', 'IN_PROGRESS'] },
      OR: [{ agentId: null }, { agentId: agent.id }],
    },
    data: {
      agentId: agent.id,
      status: 'IN_PROGRESS',
      startedAt: existingTask.startedAt || new Date(),
      // Claim Lease (B-2): liveness bound on this Model-B claim. Renewed by
      // agent heartbeats; reaped back to BACKLOG once expired.
      claimExpiresAt: new Date(Date.now() + getClaimLeaseMs()),
    },
  })

  if (result.count === 0) {
    const msg = action === 'claimed'
      ? 'Task already claimed by another agent'
      : 'Task assigned to another agent'
    return { error: msg, status: 409 as const }
  }

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: taskBoardInclude,
  })

  const logDetails = details || `${action === 'claimed' ? 'Claimed' : 'Started'} by ${agent.name}`

  await db.activityLog.create({
    data: {
      action,
      taskId,
      agentId: agent.id,
      projectId: agent.projectId,
      details: logDetails,
    },
  })

  broadcastProjectEvent(agent.projectId, 'task-moved', { taskId, task })
  broadcastProjectEvent(agent.projectId, 'agent-status', {
    agentId: agent.id,
    isActive: true,
  })
  broadcastProjectEvent(
    agent.projectId,
    'agent-activity',
    toRealtimeActivity({ action, agent, details: logDetails, taskId }),
  )
  await updateAgentHeartbeat(agent.id)

  // If the task has chain steps, activate the first step
  if (task && task.steps && task.steps.length > 0) {
    const hasActiveStep = task.steps.some((s: { status: string }) => s.status === 'active')
    if (!hasActiveStep) {
      startChain(taskId, agent.projectId).catch((err) => log.error('startChain failed', err, { taskId }))
    }
  }

  return { task }
}
