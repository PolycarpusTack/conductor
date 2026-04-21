import { broadcastProjectEvent } from './realtime'
import { checkAndFireTriggers } from './triggers/evaluator'

const TRIGGERABLE = new Set([
  'chain-completed',
  'step-failed',
  'task-created',
  'step-reviewed',
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
