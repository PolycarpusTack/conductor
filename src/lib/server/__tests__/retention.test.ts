import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockProjectFindUnique = mock(() => Promise.resolve(null)) as any
const mockArtifactDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockTaskDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any

mock.module('@/lib/db', () => ({
  db: {
    project: { findUnique: mockProjectFindUnique },
    stepArtifact: { deleteMany: mockArtifactDeleteMany },
    task: { deleteMany: mockTaskDeleteMany },
  },
  isPostgresDb: false,
}))

import { purgeDeletedTasks, purgeProjectArtifacts } from '../retention'

beforeEach(() => {
  mockProjectFindUnique.mockReset()
  mockProjectFindUnique.mockResolvedValue(null)
  mockArtifactDeleteMany.mockReset()
  mockArtifactDeleteMany.mockResolvedValue({ count: 0 })
  mockTaskDeleteMany.mockReset()
  mockTaskDeleteMany.mockResolvedValue({ count: 0 })
})

describe('purgeProjectArtifacts', () => {
  test('no-op when the project has no retention configured', async () => {
    mockProjectFindUnique.mockResolvedValue({ artifactRetentionDays: null })
    expect(await purgeProjectArtifacts('p-1')).toBeNull()
    expect(mockArtifactDeleteMany).not.toHaveBeenCalled()
  })

  test('deletes only DONE-task artifacts older than the cutoff', async () => {
    mockProjectFindUnique.mockResolvedValue({ artifactRetentionDays: 30 })
    mockArtifactDeleteMany.mockResolvedValue({ count: 4 })

    const count = await purgeProjectArtifacts('p-1')
    expect(count).toBe(4)

    const call = mockArtifactDeleteMany.mock.calls[0][0]
    expect(call.where.step.task).toEqual({ projectId: 'p-1', status: 'DONE' })

    const cutoff: Date = call.where.createdAt.lt
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5_000)
  })

  test('swallows database failures (lazy purge must not break the caller)', async () => {
    mockProjectFindUnique.mockResolvedValue({ artifactRetentionDays: 7 })
    mockArtifactDeleteMany.mockRejectedValueOnce(new Error('db down'))
    expect(await purgeProjectArtifacts('p-1')).toBeNull()
  })
})

describe('purgeDeletedTasks', () => {
  test('hard-deletes tasks past the 30-day grace period', async () => {
    mockTaskDeleteMany.mockResolvedValue({ count: 2 })
    const count = await purgeDeletedTasks('p-1')
    expect(count).toBe(2)
    const call = mockTaskDeleteMany.mock.calls[0][0]
    expect(call.where.projectId).toBe('p-1')
    const cutoff: Date = call.where.deletedAt.lt
    const expectedMs = Date.now() - 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(cutoff.getTime() - expectedMs)).toBeLessThan(5_000)
  })

  test('swallows failures', async () => {
    mockTaskDeleteMany.mockRejectedValueOnce(new Error('db down'))
    expect(await purgeDeletedTasks('p-1')).toBeNull()
  })
})
