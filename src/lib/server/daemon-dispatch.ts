import { db } from '@/lib/db'
import { broadcastProjectEvent } from '@/lib/server/realtime'

interface DaemonMatch {
  daemonId: string
  hostname: string
  workspaceId: string
}

export async function findAvailableDaemon(
  runtime: string,
  workspaceId?: string,
): Promise<DaemonMatch | null> {
  const where: Record<string, unknown> = { status: 'online' }
  if (workspaceId) {
    where.workspaceId = workspaceId
  }

  const daemons = await db.daemon.findMany({
    where,
    select: {
      id: true,
      hostname: true,
      workspaceId: true,
      capabilities: true,
    },
    orderBy: { lastSeenAt: 'desc' },
  })

  for (const d of daemons) {
    let caps: Record<string, unknown>
    try {
      caps = JSON.parse(d.capabilities) as Record<string, unknown>
    } catch {
      continue
    }
    if (runtime in caps && caps[runtime] != null) {
      return {
        daemonId: d.id,
        hostname: d.hostname,
        workspaceId: d.workspaceId,
      }
    }
  }

  return null
}

export async function resolveRuntime(taskId: string, agentRuntimeAdapter?: string | null): Promise<string | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { runtimeOverride: true },
  })
  if (task?.runtimeOverride) return task.runtimeOverride
  if (agentRuntimeAdapter) return runtimeFromProjectRuntime(agentRuntimeAdapter)
  return null
}

export async function dispatchTaskToDaemon(opts: {
  taskId: string
  stepId?: string
  agentId: string
  projectId: string
  runtime: string
  workspaceId?: string
}): Promise<{ dispatched: boolean; daemonId?: string; error?: string }> {
  const { taskId, stepId, agentId, projectId, runtime, workspaceId } = opts

  const daemon = await findAvailableDaemon(runtime, workspaceId)

  if (!daemon) {
    return {
      dispatched: false,
      error: `No online daemon with ${runtime} capability found`,
    }
  }

  broadcastProjectEvent(projectId, 'daemon-task-assigned', {
    taskId,
    stepId,
    agentId,
    daemonId: daemon.daemonId,
    runtime,
  })

  await db.activityLog.create({
    data: {
      action: 'daemon_dispatched',
      taskId,
      agentId,
      projectId,
      details: JSON.stringify({
        daemonId: daemon.daemonId,
        hostname: daemon.hostname,
        runtime,
      }),
    },
  })

  return { dispatched: true, daemonId: daemon.daemonId }
}

/**
 * Dispatch a step to an available daemon. Fetches the step's agent + task +
 * workspace, resolves the required runtime, finds a matching online daemon,
 * and leases the step to that daemon. The daemon is expected to pick up
 * leased steps via GET /api/daemon/steps/next (polling). If no matching
 * daemon is available, returns `dispatched: false` and leaves the step
 * untouched so the queue will retry on the next poll.
 */
export async function dispatchStepToDaemon(
  stepId: string,
): Promise<{ dispatched: boolean; daemonId?: string; error?: string }> {
  const step = await db.taskStep.findUnique({
    where: { id: stepId },
    select: {
      id: true,
      taskId: true,
      agentId: true,
      status: true,
      leasedBy: true,
      agent: {
        select: {
          runtime: { select: { adapter: true } },
        },
      },
      task: {
        select: {
          projectId: true,
          project: { select: { workspaceId: true } },
        },
      },
    },
  })

  if (!step || !step.agentId) {
    return { dispatched: false, error: 'Step not found or has no agent' }
  }
  if (step.leasedBy) {
    return { dispatched: false, error: 'Step already leased' }
  }

  const runtime = await resolveRuntime(step.taskId, step.agent?.runtime?.adapter)
  if (!runtime) {
    return { dispatched: false, error: 'Could not resolve runtime for step' }
  }

  const workspaceId = step.task.project.workspaceId ?? undefined
  const daemon = await findAvailableDaemon(runtime, workspaceId)
  if (!daemon) {
    return { dispatched: false, error: `No online daemon with ${runtime} capability` }
  }

  // Atomically lease the step to this daemon. Guard on leasedBy: null to
  // prevent races with a concurrent dispatcher.
  const leased = await db.taskStep.updateMany({
    where: { id: stepId, leasedBy: null },
    data: { leasedBy: daemon.daemonId, leasedAt: new Date() },
  })
  if (leased.count !== 1) {
    return { dispatched: false, error: 'Step lease contended' }
  }

  broadcastProjectEvent(step.task.projectId, 'daemon-task-assigned', {
    taskId: step.taskId,
    stepId: step.id,
    agentId: step.agentId,
    daemonId: daemon.daemonId,
    runtime,
  })

  await db.activityLog.create({
    data: {
      action: 'daemon_dispatched',
      taskId: step.taskId,
      agentId: step.agentId,
      projectId: step.task.projectId,
      details: JSON.stringify({
        stepId: step.id,
        daemonId: daemon.daemonId,
        hostname: daemon.hostname,
        runtime,
      }),
    },
  })

  return { dispatched: true, daemonId: daemon.daemonId }
}

export function runtimeFromProjectRuntime(adapter: string): string | null {
  const mapping: Record<string, string> = {
    anthropic: 'claude-code',
    openai: 'codex',
    'github-copilot': 'copilot',
  }
  return mapping[adapter] || null
}
