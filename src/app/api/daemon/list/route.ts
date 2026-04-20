import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { markStaleDaemons } from '@/lib/server/daemon-auth'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('api/daemon/list')

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

  // One corrupt capabilities blob must not fail the whole listing —
  // surface it per-row instead. /api/daemon/status already does this.
  const parsed = daemons.map((d) => {
    try {
      return { ...d, capabilities: JSON.parse(d.capabilities) as Record<string, unknown> }
    } catch (err) {
      log.error('corrupt capabilities JSON', err, { daemonId: d.id })
      return { ...d, capabilities: {}, capabilitiesError: true as const }
    }
  })

  return NextResponse.json({ data: parsed, total: parsed.length })
})
