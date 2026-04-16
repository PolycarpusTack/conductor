import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { getWorkspaces } from '@/lib/server/workspace'
import { z } from 'zod'

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
})

export async function GET(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const workspaces = await getWorkspaces()

    return NextResponse.json({ data: workspaces, total: workspaces.length })
  } catch (error) {
    console.error('Workspace list error:', error)
    return NextResponse.json({ error: 'Failed to list workspaces' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const parsed = createWorkspaceSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid workspace payload' },
        { status: 400 },
      )
    }

    const { name, slug } = parsed.data

    const existing = await db.workspace.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json(
        { error: `Workspace with slug "${slug}" already exists` },
        { status: 409 },
      )
    }

    const workspace = await db.workspace.create({
      data: {
        id: randomUUID(),
        slug,
        name,
      },
    })

    return NextResponse.json(workspace)
  } catch (error) {
    console.error('Workspace creation error:', error)
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }
}
