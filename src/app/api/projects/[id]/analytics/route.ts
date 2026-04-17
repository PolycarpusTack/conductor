import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/server/admin-session'
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
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params
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
