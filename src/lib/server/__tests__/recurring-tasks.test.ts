import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { dbMock } from './db-mock'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockRecurringFindMany = mock(() => Promise.resolve([])) as any
const mockRecurringUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any
const mockTaskCreate = mock(() => Promise.resolve({ id: 'task-new' })) as any
const mockAgentFindFirst = mock(() => Promise.resolve(null)) as any
const mockModeFindMany = mock(() => Promise.resolve([])) as any
const mockActivityCreate = mock(() => Promise.resolve({})) as any
const mockFireProjectEvent = mock(() => Promise.resolve()) as any
const mockStartChain = mock(() => Promise.resolve()) as any

mock.module('@/lib/db', () => ({
  db: dbMock({
    recurringTask: { findMany: mockRecurringFindMany, updateMany: mockRecurringUpdateMany },
    task: { create: mockTaskCreate },
    agent: { findFirst: mockAgentFindFirst },
    projectMode: { findMany: mockModeFindMany },
    activityLog: { create: mockActivityCreate },
  }),
  isPostgresDb: false,
}))
mock.module('@/lib/server/project-event', () => ({
  fireProjectEvent: mockFireProjectEvent,
}))
mock.module('@/lib/server/dispatch', () => ({
  startChain: mockStartChain,
  // Full alias-import surface of the real module — bun's mock.module registry
  // is shared, so every consumer of '@/lib/server/dispatch' in this run must
  // find its named exports here. (dispatch-logic.test.ts imports via the
  // relative path '../dispatch', which is a different specifier — unaffected.)
  normalizeDagEdges: mock(() => Promise.resolve()),
  advanceChain: mock(() => Promise.resolve()),
  rewindChain: mock(() => Promise.resolve()),
  closeChain: mock(() => Promise.resolve()),
  dispatchStep: mock(() => Promise.resolve()),
  resolveTaskStatus: mock(() => Promise.resolve()),
  findPreviousAgentStep: mock(() => Promise.resolve(null)),
}))

import { computeNextRunAt, runRecurringTasks } from '../recurring-tasks'

beforeEach(() => {
  for (const m of [
    mockRecurringFindMany, mockRecurringUpdateMany, mockTaskCreate,
    mockAgentFindFirst, mockModeFindMany, mockActivityCreate,
    mockFireProjectEvent, mockStartChain,
  ]) m.mockReset()
  mockRecurringFindMany.mockResolvedValue([])
  mockRecurringUpdateMany.mockResolvedValue({ count: 1 })
  mockTaskCreate.mockResolvedValue({ id: 'task-new' })
  mockAgentFindFirst.mockResolvedValue(null)
  mockModeFindMany.mockResolvedValue([])
  mockActivityCreate.mockResolvedValue({})
  mockFireProjectEvent.mockResolvedValue(undefined)
  mockStartChain.mockResolvedValue(undefined)
})

describe('computeNextRunAt', () => {
  test('daily: later today when the time has not passed', () => {
    const from = new Date('2026-06-06T08:00:00')
    const next = computeNextRunAt('daily', { timeOfDay: '09:30' }, from)
    expect(next.getDate()).toBe(6)
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(30)
  })

  test('daily: rolls to tomorrow when the time has passed', () => {
    const from = new Date('2026-06-06T10:00:00')
    const next = computeNextRunAt('daily', { timeOfDay: '09:30' }, from)
    expect(next.getDate()).toBe(7)
  })

  test('weekly: picks the next target weekday', () => {
    const from = new Date('2026-06-06T10:00:00') // a Saturday
    const next = computeNextRunAt('weekly', { dayOfWeek: 1, timeOfDay: '09:00' }, from)
    expect(next.getDay()).toBe(1) // Monday
    expect(next.getDate()).toBe(8)
  })

  test('weekly: same weekday with passed time waits a full week', () => {
    const from = new Date('2026-06-06T10:00:00') // Saturday
    const next = computeNextRunAt('weekly', { dayOfWeek: 6, timeOfDay: '09:00' }, from)
    expect(next.getDay()).toBe(6)
    expect(next.getDate()).toBe(13)
  })

  test('monthly: clamps to day 28 and rolls to next month when passed', () => {
    const from = new Date('2026-06-30T10:00:00')
    const next = computeNextRunAt('monthly', { dayOfMonth: 99, timeOfDay: '09:00' }, from)
    expect(next.getMonth()).toBe(6) // July
    expect(next.getDate()).toBe(28)
  })

  test('always strictly in the future', () => {
    const from = new Date('2026-06-06T09:30:00')
    for (const [cadence, opts] of [
      ['daily', { timeOfDay: '09:30' }],
      ['weekly', { dayOfWeek: 6, timeOfDay: '09:30' }],
      ['monthly', { dayOfMonth: 6, timeOfDay: '09:30' }],
    ] as const) {
      expect(computeNextRunAt(cadence, opts, from).getTime()).toBeGreaterThan(from.getTime())
    }
  })
})

function makeRecurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    name: 'Weekly standup notes',
    projectId: 'proj-1',
    cadence: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: null,
    timeOfDay: '09:00',
    enabled: true,
    nextRunAt: new Date(Date.now() - 1000),
    taskTemplate: {
      name: 'Standup notes',
      titlePattern: 'Standup {date}',
      description: 'Collect updates',
      priority: 'LOW',
      tag: 'docs',
      notes: null,
      chainTemplate: null,
    },
    ...overrides,
  }
}

describe('runRecurringTasks', () => {
  test('nothing due → nothing created', async () => {
    await runRecurringTasks()
    expect(mockTaskCreate).not.toHaveBeenCalled()
  })

  test('creates a BACKLOG task from a chainless template with {date} title', async () => {
    mockRecurringFindMany.mockResolvedValue([makeRecurrence()])

    await runRecurringTasks()

    const data = mockTaskCreate.mock.calls[0][0].data
    const today = new Date().toISOString().slice(0, 10)
    expect(data.title).toBe(`Standup ${today}`)
    expect(data.status).toBe('BACKLOG')
    expect(data.priority).toBe('LOW')
    expect(data.tag).toBe('docs')
    expect(mockStartChain).not.toHaveBeenCalled()
    expect(mockFireProjectEvent).toHaveBeenCalledWith(
      'proj-1',
      'task-created',
      expect.objectContaining({ taskId: 'task-new', recurring: true }),
    )
    expect(mockActivityCreate.mock.calls[0][0].data).toMatchObject({
      action: 'recurring_task_created',
      component: 'automation',
    })
    // claim rolled nextRunAt forward
    expect(mockRecurringUpdateMany.mock.calls[0][0].data.nextRunAt.getTime())
      .toBeGreaterThan(Date.now())
  })

  test('skips a recurrence claimed by another tick', async () => {
    mockRecurringFindMany.mockResolvedValue([makeRecurrence()])
    mockRecurringUpdateMany.mockResolvedValue({ count: 0 })

    await runRecurringTasks()

    expect(mockTaskCreate).not.toHaveBeenCalled()
    expect(mockFireProjectEvent).not.toHaveBeenCalled()
  })

  test('attached chain: resolves agentRole, applies mode maxAttempts, starts the chain', async () => {
    mockRecurringFindMany.mockResolvedValue([
      makeRecurrence({
        taskTemplate: {
          name: 'Release checklist',
          titlePattern: null,
          description: null,
          priority: null,
          tag: null,
          notes: null,
          chainTemplate: {
            steps: JSON.stringify([
              { mode: 'develop', agentRole: 'developer', autoContinue: true },
              { mode: 'human', humanLabel: 'Approver', autoContinue: false },
            ]),
          },
        },
      }),
    ])
    mockAgentFindFirst.mockResolvedValue({ id: 'agent-dev' })
    mockModeFindMany.mockResolvedValue([{ name: 'develop', maxAttempts: 4 }])

    await runRecurringTasks()

    const data = mockTaskCreate.mock.calls[0][0].data
    expect(data.status).toBe('IN_PROGRESS')
    const today = new Date().toISOString().slice(0, 10)
    expect(data.title).toBe(`Release checklist — ${today}`)
    const steps = data.steps.create
    expect(steps[0]).toMatchObject({ agentId: 'agent-dev', mode: 'develop', maxRetries: 4 })
    expect(steps[1]).toMatchObject({ humanLabel: 'Approver', mode: 'human', maxRetries: 2 })
    expect(mockAgentFindFirst.mock.calls[0][0].where).toMatchObject({ projectId: 'proj-1', role: 'developer' })
    expect(mockStartChain).toHaveBeenCalledWith('task-new', 'proj-1')
  })

  test('a failing instantiation does not block the next recurrence', async () => {
    mockRecurringFindMany.mockResolvedValue([
      makeRecurrence({ id: 'rec-bad' }),
      makeRecurrence({ id: 'rec-good' }),
    ])
    mockTaskCreate
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({ id: 'task-good' })

    await runRecurringTasks()

    expect(mockTaskCreate).toHaveBeenCalledTimes(2)
    expect(mockFireProjectEvent).toHaveBeenCalledWith(
      'proj-1',
      'task-created',
      expect.objectContaining({ taskId: 'task-good' }),
    )
  })
})
