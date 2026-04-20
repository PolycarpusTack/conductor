import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing the module under test
// ---------------------------------------------------------------------------

const mockTaskFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findMany: mockTaskFindMany,
    },
  },
}))

// Import AFTER mocking
import { buildWorkingMemory } from '../memory'

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskFindMany.mockReset()
  mockTaskFindMany.mockImplementation(() => Promise.resolve([]))
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildWorkingMemory', () => {
  test('returns empty string when no completed tasks', async () => {
    const result = await buildWorkingMemory({ agentId: 'a1', projectId: 'p1' })
    expect(result).toBe('')
  })

  test('formats task with title and output', async () => {
    mockTaskFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { title: 'Fix login bug', output: 'Root cause: timeout in auth.ts. Fixed by bumping to 60s.', completedAt: new Date() },
      ])
    )
    const result = await buildWorkingMemory({ agentId: 'a1', projectId: 'p1' })
    expect(result).toContain('Fix login bug')
    expect(result).toContain('Root cause: timeout')
  })

  test('passes agentId, projectId, and status DONE in Prisma where clause', async () => {
    await buildWorkingMemory({ agentId: 'a1', projectId: 'p1' })
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agentId: 'a1', projectId: 'p1', status: 'DONE' }),
      })
    )
  })

  test('uses maxRecent as Prisma `take`', async () => {
    await buildWorkingMemory({ agentId: 'a1', projectId: 'p1', maxRecent: 3 })
    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }))
  })

  test('defaults maxRecent to 5', async () => {
    await buildWorkingMemory({ agentId: 'a1', projectId: 'p1' })
    expect(mockTaskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })

  test('truncates each entry to maxCharsPerEntry', async () => {
    mockTaskFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { title: 'Big task', output: 'x'.repeat(5000), completedAt: new Date() },
      ])
    )
    const result = await buildWorkingMemory({ agentId: 'a1', projectId: 'p1', maxCharsPerEntry: 200 })
    // The formatted entry should be well under 600 chars (title + 200 chars of output + header)
    expect(result.length).toBeLessThan(600)
    expect(result).toContain('Big task')
  })

  test('orders by completedAt desc', async () => {
    await buildWorkingMemory({ agentId: 'a1', projectId: 'p1' })
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { completedAt: 'desc' } })
    )
  })

  test('formats multiple tasks — all returned rows appear in output', async () => {
    mockTaskFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { title: 'Task Alpha', output: 'output-alpha', completedAt: new Date() },
        { title: 'Task Beta', output: 'output-beta', completedAt: new Date() },
      ])
    )
    const result = await buildWorkingMemory({ agentId: 'a1', projectId: 'p1', maxRecent: 5 })
    expect(result).toContain('Task Alpha')
    expect(result).toContain('Task Beta')
    expect(result).toContain('output-alpha')
    expect(result).toContain('output-beta')
  })
})
