import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('step-events')

export type StepEventType =
  | 'leased'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'retry_scheduled'
  | 'dead_lettered'

/**
 * Appends a row to the append-only step event log.
 *
 * Never throws — the audit trail must not break dispatch. A failed write is
 * logged and swallowed.
 */
export async function appendStepEvent(
  stepId: string,
  event: StepEventType,
  data: Record<string, unknown> | null,
): Promise<void> {
  try {
    await db.stepEvent.create({
      data: {
        stepId,
        event,
        data: data !== null ? JSON.stringify(data) : null,
      },
    })
  } catch (err) {
    log.warn('failed to append step event', { stepId, event, err: String(err) })
  }
}

/** Hard ceiling for any computed retry delay. */
const MAX_BACKOFF_MS = 3_600_000 // 1 hour

/**
 * Exponential backoff with equal jitter.
 *
 * attempt: 1-based count of attempts so far; baseMs: the step's configured
 * retryDelayMs. The deterministic component `baseMs * 2^(attempt-1)` keeps a
 * floor under the delay (a retry is never sooner than the previous fixed
 * behaviour), and an equal-sized random component spreads herds.
 */
export function computeBackoffMs(attempt: number, baseMs: number): number {
  const cappedAttempt = Math.min(Math.max(attempt, 1), 10)
  const exp = Math.min(baseMs * Math.pow(2, cappedAttempt - 1), MAX_BACKOFF_MS)
  return Math.min(exp + Math.floor(Math.random() * exp), MAX_BACKOFF_MS)
}

export interface StepSnapshot {
  id: string
  taskId: string
  agentId?: string | null
  mode: string
  instructions?: string | null
  attempts: number
}

/**
 * Copies an exhausted step into the dead-letter table and records a
 * `dead_lettered` event. The original step row is left to the caller
 * (dispatch marks it `failed`).
 */
export async function moveToDeadLetter(step: StepSnapshot, lastError: string): Promise<void> {
  await db.deadLetterStep.create({
    data: {
      originalStepId: step.id,
      taskId: step.taskId,
      agentId: step.agentId ?? null,
      mode: step.mode,
      instructions: step.instructions ?? null,
      attempts: step.attempts,
      lastError,
      lastErrorAt: new Date(),
      payload: JSON.stringify(step),
    },
  })

  await appendStepEvent(step.id, 'dead_lettered', { reason: lastError })
}
