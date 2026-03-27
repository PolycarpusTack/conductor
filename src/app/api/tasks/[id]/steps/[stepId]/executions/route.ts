import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'

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

    const executions = await db.stepExecution.findMany({
      where: { stepId },
      orderBy: { attempt: 'asc' },
    })

    return NextResponse.json(executions)
  } catch (error) {
    console.error('Error fetching executions:', error)
    return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 })
  }
}
