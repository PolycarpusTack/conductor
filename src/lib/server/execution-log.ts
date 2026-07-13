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

/**
 * Find the StepExecution row for the CURRENT run of a step, or create one.
 *
 * The daemon path derives attempt numbers from `step.attempts + 1`, which
 * restarts at 1 after a fallback-agent escalation resets `attempts` — but the
 * failed agent's terminal rows survive under those same attempt numbers.
 * Looking a row up by attempt number would resurrect a terminal row and
 * overwrite its recorded outcome (a failed attempt silently becoming a
 * success), so only a still-`running` latest row is ever reused; anything
 * else allocates a fresh row past the highest existing attempt (mirrors the
 * HTTP path's allocateExecution, which never reuses rows either).
 */
export async function findOrCreateRunningExecution(stepId: string, minAttempt: number) {
  const latest = await db.stepExecution.findFirst({
    where: { stepId },
    orderBy: { attempt: 'desc' },
    select: { id: true, attempt: true, status: true },
  })
  if (latest?.status === 'running') return latest
  return createExecution(stepId, Math.max((latest?.attempt ?? 0) + 1, minAttempt))
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
