import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminOrScopedKey } from '@/lib/server/api-auth'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { deriveHostStatus } from '@/lib/server/host-presence'
import { safeJsonParse } from '@/lib/server/utils'

/** GET /api/hosts/[id] — host detail with daemons. Sessions arrive in Epic 2. */
export const GET = withErrorHandling(
  'api/hosts/[id]',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminOrScopedKey(request, 'read')
    if (unauthorized) return unauthorized

    const { id } = await params
    const host = await db.host.findUnique({
      where: { id },
      include: {
        daemons: {
          select: {
            id: true,
            hostname: true,
            platform: true,
            version: true,
            capabilities: true,
            sessionCapabilities: true,
            status: true,
            lastSeenAt: true,
            tokenPreview: true,
          },
          orderBy: { lastSeenAt: 'desc' },
        },
      },
    })

    if (!host) throw notFound('Host not found')

    return NextResponse.json({
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
      createdAt: host.createdAt,
      metadata: safeJsonParse<Record<string, unknown>>(host.metadata, {}),
      daemons: host.daemons.map((d) => ({
        ...d,
        capabilities: safeJsonParse<Record<string, unknown>>(d.capabilities, {}),
        sessionCapabilities: safeJsonParse<Record<string, unknown> | null>(d.sessionCapabilities, null),
      })),
      sessions: await db.agentSession.findMany({
        where: { hostId: host.id },
        orderBy: [{ lastActivityAt: 'desc' }, { startedAt: 'desc' }],
        take: 20,
      }),
    })
  },
)
