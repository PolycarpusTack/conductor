import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createTriggerSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withErrorHandling<Ctx>('api/projects/[id]/triggers', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId } = await params
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw notFound('Project not found')

  const triggers = await db.trigger.findMany({
    where: { projectId },
    include: { reactions: { orderBy: { order: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(triggers)
})

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId } = await params
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
  if (!project) throw notFound('Project not found')

  const parsed = createTriggerSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid trigger payload')

  const { eventFilters, pollConfig, ...rest } = parsed.data
  const trigger = await db.trigger.create({
    data: {
      ...rest,
      projectId,
      eventFilters: JSON.stringify(eventFilters),
      pollConfig: JSON.stringify(pollConfig),
    },
    include: { reactions: true },
  })

  return NextResponse.json(trigger, { status: 201 })
})
