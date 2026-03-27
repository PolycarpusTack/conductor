import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateChainTemplateSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.chainTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Chain template not found in this project' }, { status: 404 })
    }
    const parsed = updateChainTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid chain template payload' },
        { status: 400 },
      )
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
  } catch (error) {
    console.error('Error updating chain template:', error)
    return NextResponse.json({ error: 'Failed to update chain template' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, templateId } = await params
    const existing = await db.chainTemplate.findUnique({ where: { id: templateId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Chain template not found in this project' }, { status: 404 })
    }
    await db.chainTemplate.delete({ where: { id: templateId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting chain template:', error)
    return NextResponse.json({ error: 'Failed to delete chain template' }, { status: 500 })
  }
}
