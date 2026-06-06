import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { broadcastProjectEvent } from '@/lib/server/realtime'

/** POST /api/tasks/[id]/unarchive — bring an archived task back (Epic S7). */
export const POST = withErrorHandling(
  'api/tasks/[id]/unarchive',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, projectId: true, archivedAt: true },
    })
    if (!task || !task.archivedAt) throw notFound('No archived task with this id')

    await db.task.update({ where: { id }, data: { archivedAt: null } })

    // Boards listen for task-created to refetch — unarchiving is a (re)appearance
    broadcastProjectEvent(task.projectId, 'task-created', { taskId: id, unarchived: true })

    return NextResponse.json({ success: true, taskId: id })
  },
)
