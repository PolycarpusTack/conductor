import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { updateProjectRuntimeSchema } from '@/lib/server/contracts'

export const PUT = withErrorHandling(
  'api/projects/[id]/runtimes/[rid]',
  async (request: Request, { params }: { params: Promise<{ id: string; rid: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, rid } = await params
    const existing = await db.projectRuntime.findUnique({ where: { id: rid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Runtime not found in this project')
    }
    const parsed = updateProjectRuntimeSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid runtime payload')
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
  },
)

export const DELETE = withErrorHandling(
  'api/projects/[id]/runtimes/[rid]',
  async (request: Request, { params }: { params: Promise<{ id: string; rid: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, rid } = await params
    const existing = await db.projectRuntime.findUnique({ where: { id: rid }, select: { projectId: true } })
    if (!existing || existing.projectId !== id) {
      throw notFound('Runtime not found in this project')
    }
    await db.projectRuntime.delete({ where: { id: rid } })

    return NextResponse.json({ success: true })
  },
)
