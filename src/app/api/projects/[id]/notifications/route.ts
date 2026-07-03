import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'

const LIST_LIMIT = 50

/**
 * GET /api/projects/[id]/notifications — unread first (each group
 * newest-first), capped at 50, plus the total unread count for the badge.
 * Two queries instead of orderBy-nulls so SQLite and Postgres behave alike.
 */
export const GET = withErrorHandling(
  'api/projects/[id]/notifications',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id: projectId } = await params

    const [unread, unreadCount] = await Promise.all([
      db.notification.findMany({
        where: { projectId, readAt: null },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      db.notification.count({ where: { projectId, readAt: null } }),
    ])

    const read =
      unread.length < LIST_LIMIT
        ? await db.notification.findMany({
            where: { projectId, readAt: { not: null } },
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT - unread.length,
          })
        : []

    return NextResponse.json({ notifications: [...unread, ...read], unreadCount })
  },
)

const markReadSchema = z
  .object({
    id: z.string().min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.id) || data.all === true, {
    message: 'Provide a notification id or all: true',
  })

/** POST /api/projects/[id]/notifications — mark one ({ id }) or all ({ all: true }) read. */
export const POST = withErrorHandling(
  'api/projects/[id]/notifications',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id: projectId } = await params
    const parsed = markReadSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) throw badRequest('Provide a notification id or all: true')

    // Always project-scoped so one project's route can't touch another's rows.
    const where = parsed.data.all
      ? { projectId, readAt: null }
      : { id: parsed.data.id, projectId, readAt: null }

    const result = await db.notification.updateMany({
      where,
      data: { readAt: new Date() },
    })

    return NextResponse.json({ updated: result.count })
  },
)
