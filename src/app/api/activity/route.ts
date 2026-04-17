import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { activityQuerySchema } from '@/lib/server/contracts'

export const GET = withErrorHandling('api/activity', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const parsed = activityQuerySchema.safeParse({
    projectId: searchParams.get('projectId'),
    limit: searchParams.get('limit') || undefined,
    agentId: searchParams.get('agentId') || undefined,
  })

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid activity query')
  }

  const { projectId, limit, agentId } = parsed.data
  const where: { projectId: string; agentId?: string } = { projectId }

  if (agentId) where.agentId = agentId

  const activities = await db.activityLog.findMany({
    where,
    include: {
      agent: { select: { name: true, emoji: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json(activities)
})
