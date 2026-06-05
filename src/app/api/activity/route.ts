import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminOrScopedKey } from '@/lib/server/api-auth'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { activityQuerySchema } from '@/lib/server/contracts'
import { purgeProjectLogs } from '@/lib/server/activity-logger'
import { purgeProjectArtifacts } from '@/lib/server/retention'

export const GET = withErrorHandling('api/activity', async (request: Request) => {
  // Admin session OR a scoped API key with "read" — integration-friendly
  const unauthorized = await requireAdminOrScopedKey(request, 'read')
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const parsed = activityQuerySchema.safeParse({
    projectId: searchParams.get('projectId'),
    limit: searchParams.get('limit') || undefined,
    agentId: searchParams.get('agentId') || undefined,
    level: searchParams.get('level') || undefined,
    component: searchParams.get('component') || undefined,
    search: searchParams.get('search') || undefined,
    traceId: searchParams.get('traceId') || undefined,
  })

  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid activity query')
  }

  const { projectId, limit, agentId, level, component, search, traceId } = parsed.data

  const where: Record<string, unknown> = { projectId }
  if (agentId) where.agentId = agentId
  if (level) where.level = level
  if (component) where.component = component
  if (traceId) where.traceId = traceId
  if (search) {
    where.OR = [
      { action: { contains: search } },
      { details: { contains: search } },
    ]
  }

  const activities = await db.activityLog.findMany({
    where,
    include: {
      agent: { select: { name: true, emoji: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Lazy purge: fire-and-forget after response data is ready. Does not delay
  // the response. Each only runs if the project has the matching retention
  // policy configured.
  void purgeProjectLogs(projectId)
  void purgeProjectArtifacts(projectId)

  return NextResponse.json(activities)
})
