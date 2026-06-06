import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateRecurringTaskSchema } from '@/lib/server/contracts'
import { computeNextRunAt, type Cadence } from '@/lib/server/recurring-tasks'

type Ctx = { params: Promise<{ id: string; recurringId: string }> }

export const PUT = withErrorHandling<Ctx>(
  'api/projects/[id]/recurring-tasks/[recurringId]',
  async (request, { params }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, recurringId } = await params
    const existing = await db.recurringTask.findUnique({ where: { id: recurringId } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Recurring task not found in this project')
    }

    const parsed = updateRecurringTaskSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid recurring task payload')
    }

    if (parsed.data.taskTemplateId) {
      const template = await db.taskTemplate.findUnique({
        where: { id: parsed.data.taskTemplateId },
        select: { projectId: true },
      })
      if (!template || template.projectId !== id) {
        throw badRequest('Task template must belong to the same project')
      }
    }

    // Cadence-shaping fields changed → recompute the next occurrence.
    const cadenceTouched =
      parsed.data.cadence !== undefined ||
      parsed.data.dayOfWeek !== undefined ||
      parsed.data.dayOfMonth !== undefined ||
      parsed.data.timeOfDay !== undefined

    const merged = { ...existing, ...parsed.data }

    const recurrence = await db.recurringTask.update({
      where: { id: recurringId },
      data: {
        ...parsed.data,
        ...(cadenceTouched
          ? {
              nextRunAt: computeNextRunAt(
                merged.cadence as Cadence,
                { dayOfWeek: merged.dayOfWeek, dayOfMonth: merged.dayOfMonth, timeOfDay: merged.timeOfDay },
                new Date(),
              ),
            }
          : {}),
      },
      include: { taskTemplate: { select: { id: true, name: true, icon: true } } },
    })

    return NextResponse.json(recurrence)
  },
)

export const DELETE = withErrorHandling<Ctx>(
  'api/projects/[id]/recurring-tasks/[recurringId]',
  async (_request, { params }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, recurringId } = await params
    const existing = await db.recurringTask.findUnique({ where: { id: recurringId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Recurring task not found in this project')
    }
    await db.recurringTask.delete({ where: { id: recurringId } })

    return NextResponse.json({ success: true })
  },
)
