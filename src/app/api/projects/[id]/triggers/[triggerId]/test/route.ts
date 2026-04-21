import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withErrorHandling, notFound } from '@/lib/server/api-errors'
import { requireAdminSession } from '@/lib/server/admin-session'
import { executeReactions } from '@/lib/server/reactions/executor'

type Ctx = { params: Promise<{ id: string; triggerId: string }> }

export const POST = withErrorHandling<Ctx>('api/projects/[id]/triggers/[triggerId]/test', async (request, { params }) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const { id: projectId, triggerId } = await params
  const trigger = await db.trigger.findFirst({
    where: { id: triggerId, projectId },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  if (!trigger) throw notFound('Trigger not found')

  const body = await request.json().catch(() => ({}))
  const payload = (body as Record<string, unknown>).payload ?? {}

  await executeReactions(trigger, payload, undefined)
  return NextResponse.json({ ok: true })
})
