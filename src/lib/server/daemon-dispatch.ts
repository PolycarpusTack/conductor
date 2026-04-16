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

export function runtimeFromProjectRuntime(adapter: string): string | null {
  const mapping: Record<string, string> = {
    anthropic: 'claude-code',
    openai: 'codex',
    'github-copilot': 'copilot',
  }
  return mapping[adapter] || null
}
