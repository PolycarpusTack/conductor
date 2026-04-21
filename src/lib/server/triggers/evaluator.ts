import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/server/utils'
import { executeReactions } from '@/lib/server/reactions/executor'

export type TriggerFilter = {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'matches'
  value: string
}

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function matchesFilter(payload: unknown, filter: TriggerFilter): boolean {
  const raw = getNestedValue(payload, filter.field)
  const value = raw === undefined || raw === null ? '' : String(raw)

  switch (filter.operator) {
    case 'equals':     return value === filter.value
    case 'not_equals': return value !== filter.value
    case 'contains':   return value.includes(filter.value)
    case 'not_contains': return !value.includes(filter.value)
    case 'matches': {
      try { return new RegExp(filter.value).test(value) } catch { return false }
    }
  }
}

export async function checkAndFireTriggers(
  projectId: string,
  eventType: string,
  payload: unknown,
): Promise<void> {
  const triggers = await db.trigger.findMany({
    where: { projectId, type: 'event', eventType, enabled: true },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  for (const trigger of triggers) {
    const filters = safeJsonParse<TriggerFilter[]>(trigger.eventFilters, [])
    const matches = filters.every(f => matchesFilter(payload, f))
    if (!matches) continue

    const taskId = (payload as Record<string, unknown>)?.taskId as string | undefined

    executeReactions(trigger, payload, taskId).catch(() => {})
    await db.trigger.update({ where: { id: trigger.id }, data: { lastFiredAt: new Date() } })
  }
}
