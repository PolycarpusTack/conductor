import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { stepArtifactSchema } from '@/lib/server/contracts'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

    const artifacts = await db.stepArtifact.findMany({
      where: { stepId },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json(artifacts)
  } catch (error) {
    console.error('Error fetching artifacts:', error)
    return NextResponse.json({ error: 'Failed to fetch artifacts' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stepId: string }> },
) {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params
    const body = await request.json()

    const parsed = stepArtifactSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid artifact payload' },
        { status: 400 },
      )
    }

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) {
      return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    }

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
  } catch (error) {
    console.error('Error creating artifact:', error)
    return NextResponse.json({ error: 'Failed to create artifact' }, { status: 500 })
  }
}
