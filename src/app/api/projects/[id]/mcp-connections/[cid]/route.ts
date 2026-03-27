import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { updateProjectMcpSchema } from '@/lib/server/contracts'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, cid } = await params
    const existing = await db.projectMcpConnection.findUnique({ where: { id: cid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'MCP connection not found in this project' }, { status: 404 })
    }
    const parsed = updateProjectMcpSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid MCP connection payload' },
        { status: 400 },
      )
    }

    const data = { ...parsed.data } as Record<string, unknown>
    if (parsed.data.config) {
      data.config = JSON.stringify(parsed.data.config)
    }
    if (parsed.data.scopes) {
      data.scopes = JSON.stringify(parsed.data.scopes)
    }

    const connection = await db.projectMcpConnection.update({
      where: { id: cid },
      data,
    })

    return NextResponse.json(connection)
  } catch (error) {
    console.error('Error updating MCP connection:', error)
    return NextResponse.json({ error: 'Failed to update MCP connection' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, cid } = await params
    const existing = await db.projectMcpConnection.findUnique({ where: { id: cid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      return NextResponse.json({ error: 'MCP connection not found in this project' }, { status: 404 })
    }
    await db.projectMcpConnection.delete({ where: { id: cid } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting MCP connection:', error)
    return NextResponse.json({ error: 'Failed to delete MCP connection' }, { status: 500 })
  }
}
