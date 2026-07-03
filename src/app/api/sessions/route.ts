import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { authorizeAdminOrScopedKey, warnLegacyUnboundKey } from '@/lib/server/api-auth'
import { withErrorHandling } from '@/lib/server/api-errors'

/**
 * GET /api/sessions?workspaceId&taskId&status&limit — observable daemon
 * sessions, newest activity first. Admin session OR scoped "read" key.
 */
export const GET = withErrorHandling('api/sessions', async (request: Request) => {
  const auth = await authorizeAdminOrScopedKey(request, 'read')
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const workspaceId = searchParams.get('workspaceId')
  const taskId = searchParams.get('taskId')
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200)

  // Project-scoped keys (B-4): sessions have no explicit project parameter,
  // so a bound key is force-scoped to its own project instead of rejected.
  // Legacy unbound keys keep the instance-wide view (deprecated).
  const keyProjectId = auth.via === 'key' ? auth.projectId : null
  if (auth.via === 'key' && auth.projectId === null) warnLegacyUnboundKey(auth.keyId)

  const sessions = await db.agentSession.findMany({
    where: {
      ...(keyProjectId ? { projectId: keyProjectId } : {}),
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
