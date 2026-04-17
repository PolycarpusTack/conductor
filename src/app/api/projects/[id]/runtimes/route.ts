import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createProjectRuntimeSchema } from '@/lib/server/contracts'

export const GET = withErrorHandling(
  'api/projects/[id]/runtimes',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const runtimes = await db.projectRuntime.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(runtimes)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/runtimes',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createProjectRuntimeSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid runtime payload')
    }

    const runtime = await db.projectRuntime.create({
      data: {
        ...parsed.data,
        models: JSON.stringify(parsed.data.models),
        config: parsed.data.config ? JSON.stringify(parsed.data.config) : null,
        projectId: id,
      },
    })

    return NextResponse.json(runtime)
  },
)
