import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateTaskTemplateSchema } from '@/lib/server/contracts'

export const PUT = withErrorHandling(
  'api/projects/[id]/task-templates/[templateId]',
  async (request: Request, { params }: { params: Promise<{ id: string; templateId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.taskTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Task template not found in this project')
    }
    const parsed = updateTaskTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid task template payload')
    }

    if (parsed.data.chainTemplateId) {
      const chain = await db.chainTemplate.findUnique({
        where: { id: parsed.data.chainTemplateId },
        select: { projectId: true },
      })
      if (!chain || chain.projectId !== id) {
        throw badRequest('Attached chain template must belong to the same project')
      }
    }

    const template = await db.taskTemplate.update({
      where: { id: templateId },
      data: parsed.data,
    })

    return NextResponse.json(template)
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]/task-templates/[templateId]',
  async (request: Request, { params }: { params: Promise<{ id: string; templateId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.taskTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Task template not found in this project')
    }
    await db.taskTemplate.delete({ where: { id: templateId } })

    return NextResponse.json({ success: true })
  },
)
