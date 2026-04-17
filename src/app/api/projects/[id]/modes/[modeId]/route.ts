import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateProjectModeSchema } from '@/lib/server/contracts'

export const PUT = withErrorHandling(
  'api/projects/[id]/modes/[modeId]',
  async (request: Request, { params }: { params: Promise<{ id: string; modeId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, modeId } = await params
    const existing = await db.projectMode.findUnique({ where: { id: modeId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Mode not found in this project')
    }
    const parsed = updateProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid mode payload')
    }

    const mode = await db.projectMode.update({
      where: { id: modeId },
      data: parsed.data,
    })

    return NextResponse.json(mode)
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]/modes/[modeId]',
  async (request: Request, { params }: { params: Promise<{ id: string; modeId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, modeId } = await params
    const existing = await db.projectMode.findUnique({ where: { id: modeId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Mode not found in this project')
    }
    await db.projectMode.delete({ where: { id: modeId } })

    return NextResponse.json({ success: true })
  },
)
