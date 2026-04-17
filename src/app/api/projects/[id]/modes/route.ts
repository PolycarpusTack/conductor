import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createProjectModeSchema } from '@/lib/server/contracts'
import { ensureProjectModes } from '@/lib/server/default-modes'

export const GET = withErrorHandling(
  'api/projects/[id]/modes',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    await ensureProjectModes(id)

    const modes = await db.projectMode.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(modes)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/modes',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectModeSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid mode payload')
    }

    const mode = await db.projectMode.create({
      data: { ...parsed.data, projectId: id },
    })

    return NextResponse.json(mode)
  },
)
