import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'

export const GET = withErrorHandling(
  'api/tasks/[id]/steps/[stepId]/executions',
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; stepId: string }> },
  ) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id, stepId } = await params

    const step = await db.taskStep.findUnique({
      where: { id: stepId },
      select: { taskId: true },
    })

    if (!step || step.taskId !== id) throw notFound('Step not found')

    const executions = await db.stepExecution.findMany({
      where: { stepId },
      orderBy: { attempt: 'asc' },
    })

    return NextResponse.json(executions)
  },
)
