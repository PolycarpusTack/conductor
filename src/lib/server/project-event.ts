import { broadcastProjectEvent } from './realtime'
import { checkAndFireTriggers } from './triggers/evaluator'

const TRIGGERABLE = new Set([
  'chain-completed',
  'step-failed',
  'task-created',
  'step-reviewed',
  // Synthetic events from the automation sweep (Epic S7 Phase 2)
  'task-stale',
  'review-gate-stale',
])

export async function fireProjectEvent(
  projectId: string,
  event: string,
  payload: unknown,
): Promise<void> {
  await broadcastProjectEvent(projectId, event, payload)
  if (TRIGGERABLE.has(event)) {
    checkAndFireTriggers(projectId, event, payload).catch(() => {})
  }
}
