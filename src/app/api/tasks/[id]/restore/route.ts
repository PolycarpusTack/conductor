import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/** POST /api/tasks/[id]/restore — un-delete a soft-deleted task (Epic S3). */
export const POST = withErrorHandling(
  'api/tasks/[id]/restore',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, projectId: true, deletedAt: true },
    })
    if (!task || !task.deletedAt) throw notFound('No deleted task with this id')

    await db.task.update({ where: { id }, data: { deletedAt: null } })

    // Boards listen for task-created to refetch — restoring is a (re)appearance
    broadcastProjectEvent(task.projectId, 'task-created', { taskId: id, restored: true })

    return NextResponse.json({ success: true, taskId: id })
  },
)
