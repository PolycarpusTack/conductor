import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/server/admin-session'
import {
  getProjectStats,
  getAgentScorecard,
  getRuntimeStats,
  getFailureClusters,
  getChainBottlenecks,
} from '@/lib/server/analytics'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
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
        return NextResponse.json(
          { error: `Unknown view: ${view}. Use: overview, agents, runtimes, failures, bottlenecks` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 })
  }
}
