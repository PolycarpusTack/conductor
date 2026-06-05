import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminOrScopedKey } from '@/lib/server/api-auth'
import { withErrorHandling } from '@/lib/server/api-errors'

/**
 * GET /api/sessions?workspaceId&taskId&status&limit — observable daemon
 * sessions, newest activity first. Admin session OR scoped "read" key.
 */
export const GET = withErrorHandling('api/sessions', async (request: Request) => {
  const unauthorized = await requireAdminOrScopedKey(request, 'read')
  if (unauthorized) return unauthorized

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  const taskId = searchParams.get('taskId')
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

  const sessions = await db.agentSession.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: [{ lastActivityAt: 'desc' }, { startedAt: 'desc' }],
    take: limit,
    include: { host: { select: { id: true, displayName: true, hostname: true } } },
  })

  return NextResponse.json({ sessions })
})
