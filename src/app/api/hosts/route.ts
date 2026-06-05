import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminOrScopedKey } from '@/lib/server/api-auth'
import { withErrorHandling } from '@/lib/server/api-errors'
import { deriveHostStatus } from '@/lib/server/host-presence'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * GET /api/hosts?workspaceId= — machines with daemon counts and presence.
 * Admin session OR a scoped API key with "read" (monitoring-friendly).
 */
export const GET = withErrorHandling('api/hosts', async (request: Request) => {
  const unauthorized = await requireAdminOrScopedKey(request, 'read')
  if (unauthorized) return unauthorized

  const workspaceId = new URL(request.url).searchParams.get('workspaceId')

  const hosts = await db.host.findMany({
    where: workspaceId ? { workspaceId } : {},
    include: {
      daemons: {
        select: { id: true, status: true, version: true, capabilities: true, lastSeenAt: true },
      },
    },
    orderBy: { lastSeenAt: 'desc' },
  })

  return NextResponse.json({
    hosts: hosts.map((host) => {
      // Capability rollup across the host's daemons (e.g. claude-code, codex)
      const capabilities = new Set<string>()
      for (const daemon of host.daemons) {
        for (const key of Object.keys(safeJsonParse<Record<string, unknown>>(daemon.capabilities, {}))) {
          capabilities.add(key)
        }
      }

      return {
        id: host.id,
        workspaceId: host.workspaceId,
        slug: host.slug,
        displayName: host.displayName,
        hostname: host.hostname,
        platform: host.platform,
        arch: host.arch,
        labels: safeJsonParse<string[]>(host.labels, []),
        trustLevel: host.trustLevel,
        status: deriveHostStatus(host.lastSeenAt),
        lastSeenAt: host.lastSeenAt,
        daemonCount: host.daemons.length,
        onlineDaemons: host.daemons.filter((d) => d.status === 'online').length,
        capabilities: [...capabilities].sort(),
        metadata: safeJsonParse<Record<string, unknown>>(host.metadata, {}),
      }
    }),
  })
})
