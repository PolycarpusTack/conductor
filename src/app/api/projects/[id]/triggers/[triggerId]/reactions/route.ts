import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound, conflict } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createReactionSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const trigger = await db.trigger.findFirst({ where: { id: triggerId, projectId } })
  if (!trigger) throw notFound('Trigger not found')

  const parsed = createReactionSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid reaction payload')

  const existing = await db.reaction.findFirst({ where: { triggerId, order: parsed.data.order } })
  if (existing) throw conflict(`A reaction with order ${parsed.data.order} already exists on this trigger`)

  const { config, ...rest } = parsed.data
  const reaction = await db.reaction.create({
    data: { ...rest, triggerId, config: JSON.stringify(config) },
  })

  return NextResponse.json(reaction, { status: 201 })
})
