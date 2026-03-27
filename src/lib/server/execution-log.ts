import { db } from '@/lib/db'

export async function createExecution(stepId: string, attempt: number) {
  return db.stepExecution.create({
    data: {
      stepId,
      attempt,
      status: 'running',
      startedAt: new Date(),
    },
  })
}

export async function succeedExecution(
  executionId: string,
  output: string,
  tokensUsed?: number,
  cost?: number,
) {
  const now = new Date()
  const execution = await db.stepExecution.findUnique({
    where: { id: executionId },
    select: { startedAt: true },
  })

  const durationMs = execution?.startedAt
    ? now.getTime() - execution.startedAt.getTime()
    : null

  return db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'succeeded',
      output,
      tokensUsed: tokensUsed ?? null,
      cost: cost ?? null,
      durationMs,
      completedAt: now,
    },
  })
}

export async function failExecution(executionId: string, error: string) {
  const now = new Date()
  const execution = await db.stepExecution.findUnique({
    where: { id: executionId },
    select: { startedAt: true },
  })

  const durationMs = execution?.startedAt
    ? now.getTime() - execution.startedAt.getTime()
    : null

  return db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'failed',
      error,
      durationMs,
      completedAt: now,
    },
  })
}

export async function timeoutExecution(executionId: string) {
  const now = new Date()
  const execution = await db.stepExecution.findUnique({
    where: { id: executionId },
    select: { startedAt: true },
  })

  const durationMs = execution?.startedAt
    ? now.getTime() - execution.startedAt.getTime()
    : null

  return db.stepExecution.update({
    where: { id: executionId },
    data: {
      status: 'timed_out',
      error: 'Step execution timed out',
      durationMs,
      completedAt: now,
    },
  })
}

export async function getExecutionHistory(stepId: string) {
  return db.stepExecution.findMany({
    where: { stepId },
    orderBy: { attempt: 'asc' },
  })
}

export async function getLatestExecution(stepId: string) {
  return db.stepExecution.findFirst({
    where: { stepId },
    orderBy: { attempt: 'desc' },
  })
}
