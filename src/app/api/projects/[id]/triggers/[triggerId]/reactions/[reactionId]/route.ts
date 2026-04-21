import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, badRequest, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateReactionSchema } from '@/lib/server/contracts'

type Ctx = { params: Promise<{ id: string; triggerId: string; reactionId: string }> }

export const PUT = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId, reactionId } = await params
  const existing = await db.reaction.findFirst({
    where: { id: reactionId, triggerId, trigger: { projectId } },
  })
  if (!existing) throw notFound('Reaction not found')

  const parsed = updateReactionSchema.safeParse(await request.json())
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid payload')

  const { config, ...rest } = parsed.data
  const reaction = await db.reaction.update({
    where: { id: reactionId },
    data: {
      ...rest,
      ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
    },
  })

  return NextResponse.json(reaction)
})

export const DELETE = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/reactions/[reactionId]', async (_, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId, reactionId } = await params
  const existing = await db.reaction.findFirst({
    where: { id: reactionId, triggerId, trigger: { projectId } },
  })
  if (!existing) throw notFound('Reaction not found')

  await db.reaction.delete({ where: { id: reactionId } })
  return NextResponse.json({ deleted: true })
})
