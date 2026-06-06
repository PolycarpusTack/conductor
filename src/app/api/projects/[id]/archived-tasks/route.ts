import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'

/** GET /api/projects/[id]/archived-tasks — archived tasks (Epic S7). Unlike
 * deleted tasks these are never purged: archived means kept, out of the way. */
export const GET = withErrorHandling(
  'api/projects/[id]/archived-tasks',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params
    const tasks = await db.task.findMany({
      where: { projectId, archivedAt: { not: null }, deletedAt: null },
      select: { id: true, title: true, status: true, archivedAt: true },
      orderBy: { archivedAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ tasks })
  },
)
