import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createChainTemplateSchema } from '@/lib/server/contracts'

export const GET = withErrorHandling(
  'api/projects/[id]/chain-templates',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const templates = await db.chainTemplate.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(templates)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/chain-templates',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createChainTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid chain template payload')
    }

    const template = await db.chainTemplate.create({
      data: {
        ...parsed.data,
        steps: JSON.stringify(parsed.data.steps),
        projectId: id,
      },
    })

    return NextResponse.json(template)
  },
)
