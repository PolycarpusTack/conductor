import { db } from '@/lib/db'

export async function getProjectStats(projectId: string) {
  const tasks = await db.task.findMany({
    where: { projectId },
    select: { status: true, completedAt: true, createdAt: true },
  })

  const total = tasks.length
  const completed = tasks.filter(t => t.status === 'DONE').length
  const completionRate = total > 0 ? completed / total : 0

  const executions = await db.stepExecution.findMany({
    where: { step: { task: { projectId } } },
    select: { durationMs: true, tokensUsed: true, cost: true, status: true },
  })

  const totalTokens = executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0)
  const totalCost = executions.reduce((sum, e) => sum + (e.cost || 0), 0)
  const durations = executions.filter(e => e.durationMs != null).map(e => e.durationMs!)
  const avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0
  const successRate = executions.length > 0
    ? executions.filter(e => e.status === 'succeeded').length / executions.length
    : 0

  return {
    totalTasks: total,
    completedTasks: completed,
    completionRate: Math.round(completionRate * 100) / 100,
    totalTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    avgDurationMs,
    successRate: Math.round(successRate * 100) / 100,
    totalExecutions: executions.length,
  }
}

export async function getAgentScorecard(projectId: string) {
  const agents = await db.agent.findMany({
    where: { projectId },
    select: { id: true, name: true, emoji: true },
  })

  const scorecards = await Promise.all(agents.map(async (agent) => {
    const executions = await db.stepExecution.findMany({
      where: { step: { agent: { id: agent.id } } },
      select: { durationMs: true, tokensUsed: true, cost: true, status: true },
    })

    const succeeded = executions.filter(e => e.status === 'succeeded').length
    const failed = executions.filter(e => e.status === 'failed' || e.status === 'timed_out').length
    const totalTokens = executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0)
    const totalCost = executions.reduce((sum, e) => sum + (e.cost || 0), 0)
    const durations = executions.filter(e => e.durationMs != null).map(e => e.durationMs!)
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentEmoji: agent.emoji,
      totalExecutions: executions.length,
      succeeded,
      failed,
      successRate: executions.length > 0 ? Math.round((succeeded / executions.length) * 100) / 100 : 0,
      totalTokens,
      totalCost: Math.round(totalCost * 10000) / 10000,
      avgDurationMs,
    }
  }))

  return scorecards.sort((a, b) => b.totalExecutions - a.totalExecutions)
}

export async function getRuntimeStats(projectId: string) {
  const runtimes = await db.projectRuntime.findMany({
    where: { projectId },
    select: { id: true, name: true, adapter: true },
  })

  const stats = await Promise.all(runtimes.map(async (runtime) => {
    const executions = await db.stepExecution.findMany({
      where: {
        step: {
          agent: { runtimeId: runtime.id },
          task: { projectId },
        },
      },
      select: { durationMs: true, tokensUsed: true, cost: true, status: true },
    })

    const succeeded = executions.filter(e => e.status === 'succeeded').length
    const failed = executions.filter(e => e.status === 'failed' || e.status === 'timed_out').length
    const durations = executions.filter(e => e.durationMs != null).map(e => e.durationMs!)
    const avgLatencyMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0
    const totalTokens = executions.reduce((sum, e) => sum + (e.tokensUsed || 0), 0)
    const totalCost = executions.reduce((sum, e) => sum + (e.cost || 0), 0)

    return {
      runtimeId: runtime.id,
      runtimeName: runtime.name,
      adapter: runtime.adapter,
      totalExecutions: executions.length,
      succeeded,
      failed,
      errorRate: executions.length > 0 ? Math.round((failed / executions.length) * 100) / 100 : 0,
      avgLatencyMs,
      totalTokens,
      totalCost: Math.round(totalCost * 10000) / 10000,
    }
  }))

  return stats.sort((a, b) => b.totalExecutions - a.totalExecutions)
}

export async function getFailureClusters(projectId: string) {
  const failedExecutions = await db.stepExecution.findMany({
    where: {
      status: { in: ['failed', 'timed_out'] },
      step: { task: { projectId } },
    },
    select: { error: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  // Group by error message pattern (first 100 chars)
  const clusters = new Map<string, { count: number; lastSeen: Date; status: string }>()

  for (const exec of failedExecutions) {
    const key = (exec.error || 'Unknown error').slice(0, 100)
    const existing = clusters.get(key)
    if (existing) {
      existing.count++
      if (exec.createdAt > existing.lastSeen) {
        existing.lastSeen = exec.createdAt
      }
    } else {
      clusters.set(key, { count: 1, lastSeen: exec.createdAt, status: exec.status })
    }
  }

  return Array.from(clusters.entries())
    .map(([pattern, data]) => ({
      errorPattern: pattern,
      count: data.count,
      lastSeen: data.lastSeen,
      status: data.status,
    }))
    .sort((a, b) => b.count - a.count)
}

export async function getChainBottlenecks(projectId: string) {
  const executions = await db.stepExecution.findMany({
    where: {
      status: 'succeeded',
      step: { task: { projectId } },
    },
    select: {
      durationMs: true,
      step: {
        select: {
          mode: true,
          agent: { select: { name: true } },
        },
      },
    },
  })

  // Group by mode
  const modeStats = new Map<string, { durations: number[]; agentName: string | null }>()

  for (const exec of executions) {
    const mode = exec.step.mode
    const existing = modeStats.get(mode)
    if (existing) {
      if (exec.durationMs != null) existing.durations.push(exec.durationMs)
    } else {
      modeStats.set(mode, {
        durations: exec.durationMs != null ? [exec.durationMs] : [],
        agentName: exec.step.agent?.name || null,
      })
    }
  }

  return Array.from(modeStats.entries())
    .map(([mode, data]) => ({
      mode,
      executionCount: data.durations.length,
      avgDurationMs: data.durations.length > 0
        ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
        : 0,
      maxDurationMs: data.durations.length > 0
        ? Math.max(...data.durations)
        : 0,
    }))
    .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
}
