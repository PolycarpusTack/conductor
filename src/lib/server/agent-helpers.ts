import { db } from '@/lib/db'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

type AgentRef = { id: string; name: string; emoji: string; projectId: string }

export async function updateAgentHeartbeat(agentId: string) {
  await db.agent.update({
    where: { id: agentId },
    data: { lastSeen: new Date(), isActive: true },
  })
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

  await broadcastProjectEvent(agent.projectId, 'task-moved', { taskId, task })
  await broadcastProjectEvent(agent.projectId, 'agent-status', {
    agentId: agent.id,
    isActive: true,
  })
  await broadcastProjectEvent(
    agent.projectId,
    'agent-activity',
    toRealtimeActivity({ action, agent, details: logDetails, taskId }),
  )
  await updateAgentHeartbeat(agent.id)

  return { task }
}
