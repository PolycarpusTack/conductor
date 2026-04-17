import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, conflict, withErrorHandling } from '@/lib/server/api-errors'
import { getWorkspaces } from '@/lib/server/workspace'
import { z } from 'zod'

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
})

export const GET = withErrorHandling('api/workspaces', async () => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const workspaces = await getWorkspaces()

  return NextResponse.json({ data: workspaces, total: workspaces.length })
})

export const POST = withErrorHandling('api/workspaces', async (request: Request) => {
  const unauthorized = await requireAdminSession()
  if (unauthorized) return unauthorized

  const parsed = createWorkspaceSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid workspace payload')
  }

  const { name, slug } = parsed.data

  const existing = await db.workspace.findUnique({ where: { slug } })
  if (existing) {
    throw conflict(`Workspace with slug "${slug}" already exists`)
  }

  const workspace = await db.workspace.create({
    data: {
      id: randomUUID(),
      slug,
      name,
    },
  })

  return NextResponse.json(workspace)
})
