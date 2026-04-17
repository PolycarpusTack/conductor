import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { stepArtifactSchema } from '@/lib/server/contracts'

export const GET = withErrorHandling(
  'api/tasks/[id]/steps/[stepId]/artifacts',
  async (request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) throw notFound('Step not found')

    const artifacts = await db.stepArtifact.findMany({
      where: { stepId },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(artifacts)
  },
)

export const POST = withErrorHandling(
  'api/tasks/[id]/steps/[stepId]/artifacts',
  async (request: Request, { params }: { params: Promise<{ id: string; stepId: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params
    const body = await request.json()

    const parsed = stepArtifactSchema.safeParse(body)
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid artifact payload')
    }

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) throw notFound('Step not found')

    const artifact = await db.stepArtifact.create({
      data: {
        stepId,
        type: parsed.data.type,
        label: parsed.data.label,
        content: parsed.data.content || null,
        url: parsed.data.url || null,
        mimeType: parsed.data.mimeType || null,
        metadata: parsed.data.metadata ? JSON.stringify(parsed.data.metadata) : null,
      },
    })

    return NextResponse.json(artifact)
  },
)
