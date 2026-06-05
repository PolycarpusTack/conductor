import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { createTaskTemplateSchema } from '@/lib/server/contracts'

/** A chainTemplateId from the client must point at a chain template in THIS project. */
async function assertChainTemplateInProject(chainTemplateId: string, projectId: string) {
  const chain = await db.chainTemplate.findUnique({
    where: { id: chainTemplateId },
    select: { projectId: true },
  })
  if (!chain || chain.projectId !== projectId) {
    throw badRequest('Attached chain template must belong to the same project')
  }
}

export const GET = withErrorHandling(
  'api/projects/[id]/task-templates',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params

    const templates = await db.taskTemplate.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(templates)
  },
)

export const POST = withErrorHandling(
  'api/projects/[id]/task-templates',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const parsed = createTaskTemplateSchema.safeParse(await request.json())
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid task template payload')
    }

    if (parsed.data.chainTemplateId) {
      await assertChainTemplateInProject(parsed.data.chainTemplateId, id)
    }

    const template = await db.taskTemplate.create({
      data: {
        ...parsed.data,
        projectId: id,
      },
    })

    return NextResponse.json(template)
  },
)
