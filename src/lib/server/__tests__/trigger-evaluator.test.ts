import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockTriggerFindMany = mock(() => Promise.resolve([]))
const mockTriggerUpdate = mock(() => Promise.resolve({}))
const mockExecuteReactions = mock(() => Promise.resolve())

mock.module('@/lib/db', () => ({
  db: {
    trigger: {
      findMany: mockTriggerFindMany,
      update: mockTriggerUpdate,
    },
  },
}))

mock.module('@/lib/server/reactions/executor', () => ({
  executeReactions: mockExecuteReactions,
}))

import { checkAndFireTriggers } from '../triggers/evaluator'

function makeTrigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trig-1',
    projectId: 'proj-1',
    type: 'event',
    eventType: 'chain-completed',
    eventFilters: '[]',
    enabled: true,
    reactions: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockTriggerFindMany.mockReset()
  mockTriggerUpdate.mockReset()
  mockExecuteReactions.mockReset()
  mockTriggerFindMany.mockResolvedValue([])
  mockTriggerUpdate.mockResolvedValue({})
  mockExecuteReactions.mockResolvedValue(undefined)
})

describe('checkAndFireTriggers', () => {
  test('fires trigger with no filters when event matches', async () => {
    mockTriggerFindMany.mockResolvedValue([makeTrigger()])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'task-1' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('does not fire when equality filter does not match', async () => {
    const filters = JSON.stringify([{ field: 'status', operator: 'equals', value: 'DONE' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'FAILED' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('fires when equality filter matches', async () => {
    const filters = JSON.stringify([{ field: 'status', operator: 'equals', value: 'DONE' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'DONE' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('fires when regex filter matches', async () => {
    const filters = JSON.stringify([{ field: 'taskId', operator: 'matches', value: '^sentry-' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'sentry-abc123' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).toHaveBeenCalledTimes(1)
  })

  test('does not fire when regex filter does not match', async () => {
    const filters = JSON.stringify([{ field: 'taskId', operator: 'matches', value: '^sentry-' }])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'manual-task' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('all filters must match (AND logic)', async () => {
    const filters = JSON.stringify([
      { field: 'status', operator: 'equals', value: 'DONE' },
      { field: 'tag', operator: 'equals', value: 'critical' },
    ])
    mockTriggerFindMany.mockResolvedValue([makeTrigger({ eventFilters: filters })])

    await checkAndFireTriggers('proj-1', 'chain-completed', { status: 'DONE', tag: 'low' })
    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })

  test('returns without firing when no triggers found', async () => {
    mockTriggerFindMany.mockResolvedValue([])

    await checkAndFireTriggers('proj-1', 'chain-completed', { taskId: 'task-1' })

    await new Promise(r => setTimeout(r, 0))
    expect(mockExecuteReactions).not.toHaveBeenCalled()
  })
})
