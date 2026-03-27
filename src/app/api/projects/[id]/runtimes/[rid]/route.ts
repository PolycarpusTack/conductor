import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateProjectRuntimeSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, rid } = await params
    const existing = await db.projectRuntime.findUnique({ where: { id: rid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Runtime not found in this project' }, { status: 404 })
    }
    const parsed = updateProjectRuntimeSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid runtime payload' },
        { status: 400 },
      )
    }

    const data = { ...parsed.data } as Record<string, unknown>
    if (parsed.data.models) {
      data.models = JSON.stringify(parsed.data.models)
    }
    if (parsed.data.config !== undefined) {
      data.config = parsed.data.config ? JSON.stringify(parsed.data.config) : null
    }

    const runtime = await db.projectRuntime.update({
      where: { id: rid },
      data,
    })

    return NextResponse.json(runtime)
  } catch (error) {
    console.error('Error updating runtime:', error)
    return NextResponse.json({ error: 'Failed to update runtime' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; rid: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, rid } = await params
    const existing = await db.projectRuntime.findUnique({ where: { id: rid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'Runtime not found in this project' }, { status: 404 })
    }
    await db.projectRuntime.delete({ where: { id: rid } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting runtime:', error)
    return NextResponse.json({ error: 'Failed to delete runtime' }, { status: 500 })
  }
}
