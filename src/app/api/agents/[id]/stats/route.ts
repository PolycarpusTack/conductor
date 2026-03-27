import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const agent = await db.agent.findUnique({
      where: { id },
      select: { id: true, name: true, emoji: true },
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Task step stats
    const [allSteps, recentSteps7d, recentSteps30d] = await Promise.all([
      db.taskStep.findMany({
        where: { agentId: id, status: { in: ['done', 'failed', 'skipped'] } },
        select: { status: true, mode: true, startedAt: true, completedAt: true, attempts: true, createdAt: true },
      }),
      db.taskStep.count({
        where: { agentId: id, status: 'done', completedAt: { gte: sevenDaysAgo } },
      }),
      db.taskStep.count({
        where: { agentId: id, status: 'done', completedAt: { gte: thirtyDaysAgo } },
      }),
    ])

    // Task-level stats
    const [tasksCompleted, tasksInProgress, tasksTotal] = await Promise.all([
      db.task.count({ where: { agentId: id, status: 'DONE' } }),
      db.task.count({ where: { agentId: id, status: 'IN_PROGRESS' } }),
      db.task.count({ where: { agentId: id } }),
    ])

    // Compute metrics
    const doneSteps = allSteps.filter(s => s.status === 'done')
    const failedSteps = allSteps.filter(s => s.status === 'failed')
    const totalCompleted = doneSteps.length + failedSteps.length
    const successRate = totalCompleted > 0 ? Math.round((doneSteps.length / totalCompleted) * 100) : 0

    // Average step duration (for steps with both start and end times)
    const durations = doneSteps
      .filter(s => s.startedAt && s.completedAt)
      .map(s => new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime())
    const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

    // Mode breakdown
    const modeBreakdown: Record<string, number> = {}
    for (const step of doneSteps) {
      modeBreakdown[step.mode] = (modeBreakdown[step.mode] || 0) + 1
    }

    // Retry rate
    const stepsWithRetries = allSteps.filter(s => (s.attempts || 0) > 0).length
    const retryRate = allSteps.length > 0 ? Math.round((stepsWithRetries / allSteps.length) * 100) : 0

    return NextResponse.json({
      agent: { id: agent.id, name: agent.name, emoji: agent.emoji },
      tasks: {
        total: tasksTotal,
        completed: tasksCompleted,
        inProgress: tasksInProgress,
      },
      steps: {
        completed7d: recentSteps7d,
        completed30d: recentSteps30d,
        completedAll: doneSteps.length,
        failed: failedSteps.length,
        successRate,
        retryRate,
        avgDurationMs: Math.round(avgDurationMs),
      },
      modeBreakdown,
    })
  } catch (error) {
    console.error('Error fetching agent stats:', error)
    return NextResponse.json({ error: 'Failed to fetch agent stats' }, { status: 500 })
  }
}
