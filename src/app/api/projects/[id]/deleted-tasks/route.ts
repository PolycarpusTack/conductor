import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { withErrorHandling } from '@/lib/server/api-errors'

/** GET /api/projects/[id]/deleted-tasks — recently soft-deleted tasks (Epic S3). */
export const GET = withErrorHandling(
  'api/projects/[id]/deleted-tasks',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params
    const tasks = await db.task.findMany({
      where: { projectId, deletedAt: { not: null } },
      select: { id: true, title: true, status: true, deletedAt: true },
      orderBy: { deletedAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({ tasks })
  },
)
