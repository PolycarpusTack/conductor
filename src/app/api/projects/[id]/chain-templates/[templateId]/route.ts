import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateChainTemplateSchema } from '@/lib/server/contracts'

export const PUT = withErrorHandling(
  'api/projects/[id]/chain-templates/[templateId]',
  async (request: Request, { params }: { params: Promise<{ id: string; templateId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.chainTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Chain template not found in this project')
    }
    const parsed = updateChainTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid chain template payload')
    }

    const data = { ...parsed.data } as Record<string, unknown>
    if (parsed.data.steps) {
      data.steps = JSON.stringify(parsed.data.steps)
    }

    const template = await db.chainTemplate.update({
      where: { id: templateId },
      data,
    })

    return NextResponse.json(template)
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]/chain-templates/[templateId]',
  async (request: Request, { params }: { params: Promise<{ id: string; templateId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.chainTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Chain template not found in this project')
    }
    await db.chainTemplate.delete({ where: { id: templateId } })

    return NextResponse.json({ success: true })
  },
)
