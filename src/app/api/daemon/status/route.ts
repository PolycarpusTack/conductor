import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { markStaleDaemons } from '@/lib/server/daemon-auth'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('api/daemon/status')

export const GET = withErrorHandling('api/daemon/status', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  await markStaleDaemons()

  const daemons = await db.daemon.findMany({
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
    orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
  })

  const online = daemons.filter((d) => d.status === 'online').length
  const stale = daemons.filter((d) => d.status === 'stale').length
  const offline = daemons.filter((d) => d.status === 'offline').length

  const parsed = daemons.map((d) => {
    let caps: Record<string, unknown> = {}
    try { caps = JSON.parse(d.capabilities) } catch {
      log.error('corrupt capabilities JSON', undefined, { daemonId: d.id })
    }
    const runtimes = Object.keys(caps).filter((k) => k !== '_health')
    return { ...d, capabilities: caps, runtimes }
  })

  return NextResponse.json({
    daemons: parsed,
    summary: { total: daemons.length, online, stale, offline },
  })
})
