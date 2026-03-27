import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { createProjectMcpSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const connections = await db.projectMcpConnection.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(connections)
  } catch (error) {
    console.error('Error fetching MCP connections:', error)
    return NextResponse.json({ error: 'Failed to fetch MCP connections' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectMcpSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid MCP connection payload' },
        { status: 400 },
      )
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
  } catch (error) {
    console.error('Error creating MCP connection:', error)
    return NextResponse.json({ error: 'Failed to create MCP connection' }, { status: 500 })
  }
}
