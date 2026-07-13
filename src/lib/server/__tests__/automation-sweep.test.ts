import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { dbMock } from './db-mock'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockProjectFindMany = mock(() => Promise.resolve([])) as any
const mockProjectUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any
const mockTaskFindMany = mock(() => Promise.resolve([])) as any
const mockStepFindMany = mock(() => Promise.resolve([])) as any
const mockFireProjectEvent = mock(() => Promise.resolve()) as any

mock.module('@/lib/db', () => ({
  db: dbMock({
    project: { findMany: mockProjectFindMany, updateMany: mockProjectUpdateMany },
    task: { findMany: mockTaskFindMany },
    taskStep: { findMany: mockStepFindMany },
  }),
  isPostgresDb: false,
}))
mock.module('@/lib/server/project-event', () => ({
  fireProjectEvent: mockFireProjectEvent,
}))

import { runAutomationSweeps } from '../automation-sweep'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  for (const m of [
    mockProjectFindMany, mockProjectUpdateMany, mockTaskFindMany,
    mockStepFindMany, mockFireProjectEvent,
  ]) m.mockReset()
  mockProjectFindMany.mockResolvedValue([])
  mockProjectUpdateMany.mockResolvedValue({ count: 1 })
  mockTaskFindMany.mockResolvedValue([])
  mockStepFindMany.mockResolvedValue([])
  mockFireProjectEvent.mockResolvedValue(undefined)
})

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    autoArchiveDays: 30,
    reviewEscalationHours: null,
    lastAutomationSweepAt: null,
    ...overrides,
  }
}

describe('runAutomationSweeps', () => {
  test('no candidate projects → no events', async () => {
    await runAutomationSweeps()
    expect(mockFireProjectEvent).not.toHaveBeenCalled()
  })

  test('fires task-stale for idle DONE tasks', async () => {
    mockProjectFindMany.mockResolvedValue([makeProject()])
    mockTaskFindMany.mockResolvedValue([
      { id: 't-1', title: 'Old task', updatedAt: new Date(Date.now() - 45 * DAY) },
    ])

    await runAutomationSweeps()

    expect(mockFireProjectEvent).toHaveBeenCalledWith(
      'proj-1',
      'task-stale',
      expect.objectContaining({ taskId: 't-1', reason: 'auto-archive-candidate', idleDays: 45 }),
    )
    // only DONE, unarchived, undeleted tasks qualify
    expect(mockTaskFindMany.mock.calls[0][0].where).toMatchObject({
      projectId: 'proj-1',
      status: 'DONE',
      archivedAt: null,
      deletedAt: null,
    })
  })

  test('skips a project whose sweep was claimed by another tick', async () => {
    mockProjectFindMany.mockResolvedValue([makeProject()])
    mockProjectUpdateMany.mockResolvedValue({ count: 0 }) // lost the claim race

    await runAutomationSweeps()

    expect(mockTaskFindMany).not.toHaveBeenCalled()
    expect(mockFireProjectEvent).not.toHaveBeenCalled()
  })

  test('fires review-gate-stale for old active human gates', async () => {
    mockProjectFindMany.mockResolvedValue([
      makeProject({ autoArchiveDays: null, reviewEscalationHours: 24 }),
    ])
    mockStepFindMany.mockResolvedValue([
      {
        id: 's-1', taskId: 't-1', humanLabel: 'Reviewer',
        startedAt: null, createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      },
    ])

    await runAutomationSweeps()

    expect(mockFireProjectEvent).toHaveBeenCalledWith(
      'proj-1',
      'review-gate-stale',
      expect.objectContaining({ taskId: 't-1', stepId: 's-1', humanLabel: 'Reviewer', waitingHours: 48 }),
    )
    expect(mockStepFindMany.mock.calls[0][0].where).toMatchObject({
      status: 'active',
      mode: 'human',
    })
  })

  test('caps each event type at 50 per sweep', async () => {
    mockProjectFindMany.mockResolvedValue([makeProject()])
    mockTaskFindMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        id: `t-${i}`, title: `Task ${i}`, updatedAt: new Date(Date.now() - 60 * DAY),
      })),
    )

    await runAutomationSweeps()

    expect(mockFireProjectEvent).toHaveBeenCalledTimes(50)
  })

  test('a failing project sweep does not block the next project', async () => {
    mockProjectFindMany.mockResolvedValue([
      makeProject({ id: 'proj-bad' }),
      makeProject({ id: 'proj-good' }),
    ])
    mockTaskFindMany
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce([{ id: 't-9', title: 'ok', updatedAt: new Date(Date.now() - 60 * DAY) }])

    await runAutomationSweeps()

    expect(mockFireProjectEvent).toHaveBeenCalledWith(
      'proj-good',
      'task-stale',
      expect.objectContaining({ taskId: 't-9' }),
    )
  })
})
