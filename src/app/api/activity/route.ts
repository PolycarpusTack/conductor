import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { activityQuerySchema } from '@/lib/server/contracts'

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    const { searchParams } = new URL(request.url)
    const parsed = activityQuerySchema.safeParse({
      projectId: searchParams.get('projectId'),
      limit: searchParams.get('limit') || undefined,
      agentId: searchParams.get('agentId') || undefined,
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid activity query' },
        { status: 400 },
      )
    }

    const { projectId, limit, agentId } = parsed.data
    const where: { projectId: string; agentId?: string } = { projectId }

    if (agentId) {
      where.agentId = agentId
    }

    const activities = await db.activityLog.findMany({
      where,
      include: {
        agent: { select: { name: true, emoji: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json(activities)
  } catch (error) {
    console.error('Error fetching activities:', error)
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 })
  }
}
