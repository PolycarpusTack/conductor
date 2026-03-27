import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateProjectModeSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; modeId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, modeId } = await params
    const existing = await db.projectMode.findUnique({ where: { id: modeId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Mode not found in this project' }, { status: 404 })
    }
    const parsed = updateProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid mode payload' },
        { status: 400 },
      )
    }

    const mode = await db.projectMode.update({
      where: { id: modeId },
      data: parsed.data,
    })

    return NextResponse.json(mode)
  } catch (error) {
    console.error('Error updating mode:', error)
    return NextResponse.json({ error: 'Failed to update mode' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; modeId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, modeId } = await params
    const existing = await db.projectMode.findUnique({ where: { id: modeId }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Mode not found in this project' }, { status: 404 })
    }
    await db.projectMode.delete({ where: { id: modeId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting mode:', error)
    return NextResponse.json({ error: 'Failed to delete mode' }, { status: 500 })
  }
}
