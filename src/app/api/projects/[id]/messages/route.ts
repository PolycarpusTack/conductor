import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'
import { safeJsonParse } from '@/lib/server/utils'

/** GET /api/projects/[id]/messages?limit= — project-wide message log (admin). */
export const GET = withErrorHandling(
  'api/projects/[id]/messages',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params
    const limit = Math.min(
      parseInt(new URL(request.url).searchParams.get('limit') || '100', 10) || 100,
      500,
    )

    const messages = await db.agentMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      messages: messages.map((m) => ({
        ...m,
        bodySecurity: safeJsonParse<Record<string, unknown> | null>(m.bodySecurity, null),
      })),
    })
  },
)
