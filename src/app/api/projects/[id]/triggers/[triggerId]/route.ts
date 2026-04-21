import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateTriggerSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const PUT = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const existing = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!existing) throw notFound('Trigger not found')

  const parsed = updateTriggerSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid payload')

  const { eventFilters, pollConfig, ...rest } = parsed.data
  const trigger = await db.trigger.update({
    where: { id: triggerId },
    data: {
      ...rest,
      ...(eventFilters !== undefined ? { eventFilters: JSON.stringify(eventFilters) } : {}),
      ...(pollConfig !== undefined ? { pollConfig: JSON.stringify(pollConfig) } : {}),
    },
    include: { reactions: { orderBy: { order: 'asc' } } },
  })

  return NextResponse.json(trigger)
})

export const DELETE = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const existing = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!existing) throw notFound('Trigger not found')

  await db.trigger.delete({ where: { id: triggerId } })
  return NextResponse.json({ deleted: true })
})
