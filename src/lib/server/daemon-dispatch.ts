import { db } from '@/lib/db'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { LEASE_TIMEOUT_MS } from '@/lib/server/step-queue'

interface DaemonMatch {
  daemonId: string
  hostname: string
  workspaceId: string
}

// SECURITY: daemon selection is always workspace-scoped. Steps carry agent
// prompts and task context; matching "any online daemon" would lease that
// data to a host in an unrelated workspace. Callers must resolve a concrete
// workspaceId first — there is deliberately no any-workspace fallback.
export async function findAvailableDaemon(
  runtime: string,
  workspaceId: string,
): Promise<DaemonMatch | null> {
  const daemons = await db.daemon.findMany({
    where: { status: 'online', workspaceId },
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

  if (!workspaceId) {
    return {
      dispatched: false,
      error: 'Project has no workspace assigned; daemon dispatch requires a workspace',
    }
  }

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
      leasedAt: true,
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

  // If the step carries a lease, only reject when it's still fresh. An expired
  // lease means the previous daemon died mid-step; allow a retake.
  const leaseExpiry = new Date(Date.now() - LEASE_TIMEOUT_MS)
  if (step.leasedBy && (!step.leasedAt || step.leasedAt >= leaseExpiry)) {
    return { dispatched: false, error: 'Step already leased' }
  }
  const previousLeaseholder = step.leasedBy ?? null

  // SECURITY: a workspace-less project must never lease to an arbitrary
  // daemon — the step payload (prompts, context) would leave the project's
  // trust boundary. Fail the attempt with a durable activity-log entry so
  // the operator sees why the step is stuck and assigns a workspace.
  const workspaceId = step.task.project.workspaceId
  if (!workspaceId) {
    const error =
      'Project has no workspace assigned; assign a workspace before daemon dispatch'
    await db.activityLog.create({
      data: {
        action: 'daemon_dispatch_failed',
        taskId: step.taskId,
        agentId: step.agentId,
        projectId: step.task.projectId,
        details: JSON.stringify({ stepId, reason: 'missing_workspace', error }),
      },
    })
    return { dispatched: false, error }
  }

  const runtime = await resolveRuntime(step.taskId, step.agent?.runtime?.adapter)
  if (!runtime) {
    return { dispatched: false, error: 'Could not resolve runtime for step' }
  }

  const daemon = await findAvailableDaemon(runtime, workspaceId)
  if (!daemon) {
    return { dispatched: false, error: `No online daemon with ${runtime} capability` }
  }

  // Atomically lease the step to this daemon. Accept an unleased step or one
  // whose prior lease has expired — the `where` guard keeps races safe even
  // if two dispatchers race on a newly-expired lease.
  const leased = await db.taskStep.updateMany({
    where: {
      id: stepId,
      OR: [
        { leasedBy: null },
        { leasedAt: { lt: leaseExpiry } },
      ],
    },
    data: { leasedBy: daemon.daemonId, leasedAt: new Date() },
  })
  if (leased.count !== 1) {
    return { dispatched: false, error: 'Step lease contended' }
  }

  if (previousLeaseholder) {
    await db.activityLog.create({
      data: {
        action: 'lease_reclaimed',
        taskId: step.taskId,
        agentId: step.agentId,
        projectId: step.task.projectId,
        details: JSON.stringify({
          stepId,
          previousLeaseholder,
          newLeaseholder: daemon.daemonId,
        }),
      },
    })
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
