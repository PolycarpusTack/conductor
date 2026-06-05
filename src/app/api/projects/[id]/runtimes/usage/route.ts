import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'

const WINDOW_DAYS = 30

/**
 * GET /api/projects/[id]/runtimes/usage — 30-day execution rollup per
 * runtime: executions, tokens, cost. Aggregated in JS because the
 * runtime link traverses step→agent (Prisma groupBy can't follow it).
 */
export const GET = withErrorHandling(
  'api/projects/[id]/runtimes/usage',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

    const executions = await db.stepExecution.findMany({
      where: {
        startedAt: { gte: since },
        step: { task: { projectId }, agent: { runtimeId: { not: null } } },
      },
      select: {
        tokensUsed: true,
        cost: true,
        step: { select: { agent: { select: { runtimeId: true } } } },
      },
      take: 10_000,
    })

    const usage: Record<string, { executions: number; tokens: number; cost: number }> = {}
    for (const execution of executions) {
      const runtimeId = execution.step.agent?.runtimeId
      if (!runtimeId) continue
      const bucket = (usage[runtimeId] ??= { executions: 0, tokens: 0, cost: 0 })
      bucket.executions++
      bucket.tokens += execution.tokensUsed ?? 0
      bucket.cost += execution.cost ?? 0
    }

    return NextResponse.json({ windowDays: WINDOW_DAYS, usage })
  },
)
