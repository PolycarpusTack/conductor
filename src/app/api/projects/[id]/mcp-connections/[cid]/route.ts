import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateProjectMcpSchema } from '@/lib/server/contracts'

export const PUT = withErrorHandling(
  'api/projects/[id]/mcp-connections/[cid]',
  async (request: Request, { params }: { params: Promise<{ id: string; cid: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, cid } = await params
    const existing = await db.projectMcpConnection.findUnique({ where: { id: cid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('MCP connection not found in this project')
    }
    const parsed = updateProjectMcpSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid MCP connection payload')
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
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]/mcp-connections/[cid]',
  async (request: Request, { params }: { params: Promise<{ id: string; cid: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, cid } = await params
    const existing = await db.projectMcpConnection.findUnique({ where: { id: cid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('MCP connection not found in this project')
    }
    await db.projectMcpConnection.delete({ where: { id: cid } })

    return NextResponse.json({ success: true })
  },
)
