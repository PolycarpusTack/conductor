import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createProjectMcpSchema } from '@/lib/server/contracts'

export const GET = withErrorHandling(
  'api/projects/[id]/mcp-connections',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const connections = await db.projectMcpConnection.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(connections)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/mcp-connections',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectMcpSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid MCP connection payload')
    }

    const connection = await db.projectMcpConnection.create({
      data: {
        projectId: id,
        name: parsed.data.name,
        type: parsed.data.type,
        icon: parsed.data.icon || null,
        endpoint: parsed.data.endpoint || null,
        config: parsed.data.config ? JSON.stringify(parsed.data.config) : null,
        scopes: parsed.data.scopes ? JSON.stringify(parsed.data.scopes) : null,
      },
    })

    return NextResponse.json(connection)
  },
)
