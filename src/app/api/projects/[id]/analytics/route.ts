import { NextResponse } from 'next/server'
import { assertKeyProjectAccess, authorizeAdminOrScopedKey } from '@/lib/server/api-auth'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import {
  getProjectStats,
  getAgentScorecard,
  getRuntimeStats,
  getFailureClusters,
  getChainBottlenecks,
} from '@/lib/server/analytics'

export const GET = withErrorHandling(
  'api/projects/[id]/analytics',
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    // Admin session OR a scoped API key with "read" — integration-friendly
    const auth = await authorizeAdminOrScopedKey(request, 'read')
    if (!auth.ok) return auth.response

    const { id: projectId } = await params

    // Project-scoped keys (B-4): bound keys may only read their own project
    assertKeyProjectAccess(auth, projectId)
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'overview'

    switch (view) {
      case 'overview':
        return NextResponse.json(await getProjectStats(projectId))
      case 'agents':
        return NextResponse.json(await getAgentScorecard(projectId))
      case 'runtimes':
        return NextResponse.json(await getRuntimeStats(projectId))
      case 'failures':
        return NextResponse.json(await getFailureClusters(projectId))
      case 'bottlenecks':
        return NextResponse.json(await getChainBottlenecks(projectId))
      default:
        throw badRequest(
          `Unknown view: ${view}. Use: overview, agents, runtimes, failures, bottlenecks`,
        )
    }
  },
)
