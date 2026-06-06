import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createRecurringTaskSchema } from '@/lib/server/contracts'
import { computeNextRunAt } from '@/lib/server/recurring-tasks'

export const GET = withErrorHandling(
  'api/projects/[id]/recurring-tasks',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const recurrences = await db.recurringTask.findMany({
      where: { projectId: id },
      include: { taskTemplate: { select: { id: true, name: true, icon: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(recurrences)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/recurring-tasks',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createRecurringTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid recurring task payload')
    }

    const template = await db.taskTemplate.findUnique({
      where: { id: parsed.data.taskTemplateId },
      select: { projectId: true },
    })
    if (!template || template.projectId !== id) {
      throw badRequest('Task template must belong to the same project')
    }

    const recurrence = await db.recurringTask.create({
      data: {
        ...parsed.data,
        projectId: id,
        nextRunAt: computeNextRunAt(
          parsed.data.cadence,
          {
            dayOfWeek: parsed.data.dayOfWeek,
            dayOfMonth: parsed.data.dayOfMonth,
            timeOfDay: parsed.data.timeOfDay,
          },
          new Date(),
        ),
      },
      include: { taskTemplate: { select: { id: true, name: true, icon: true } } },
    })

    return NextResponse.json(recurrence)
  },
)
