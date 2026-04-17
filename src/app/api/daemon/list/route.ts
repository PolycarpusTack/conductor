import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { markStaleDaemons } from '@/lib/server/daemon-auth'

export const GET = withErrorHandling('api/daemon/list', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  await markStaleDaemons()

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId') || undefined
  const status = searchParams.get('status') || undefined

  const where: Record<string, unknown> = {}
  if (workspaceId) where.workspaceId = workspaceId
  if (status) where.status = status

  const daemons = await db.daemon.findMany({
    where,
    select: {
      id: true,
      hostname: true,
      platform: true,
      version: true,
      capabilities: true,
      status: true,
      lastSeenAt: true,
      workspaceId: true,
      tokenPreview: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  const parsed = daemons.map((d) => ({
    ...d,
    capabilities: JSON.parse(d.capabilities),
  }))

  return NextResponse.json({ data: parsed, total: parsed.length })
})
