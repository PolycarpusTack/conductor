import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing the module under test
// ---------------------------------------------------------------------------

const mockTaskFindMany = mock(() => Promise.resolve([])) as any
const mockAgentMemoryCreate = mock(() => Promise.resolve({})) as any
const mockAgentMemoryFindMany = mock(() => Promise.resolve([])) as any
const mockAgentMemoryUpdate = mock(() => Promise.resolve({})) as any
const mockQueryRawUnsafe = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    task: { findMany: mockTaskFindMany },
    agentMemory: {
      create: mockAgentMemoryCreate,
      findMany: mockAgentMemoryFindMany,
      update: mockAgentMemoryUpdate,
    },
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
  isPostgresDb: false, // forces the text-fallback path in all tests in this file
}))

mock.module('@/lib/server/embeddings', () => ({
  generateEmbedding: mock(() => Promise.resolve(null)), // no embedding in unit tests
}))

// Import AFTER mocking
import { buildWorkingMemory } from '../memory'

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskFindMany.mockReset()
  mockTaskFindMany.mockImplementation(() => Promise.resolve([]))
  mockAgentMemoryCreate.mockReset()
  mockAgentMemoryCreate.mockImplementation(() => Promise.resolve({}))
  mockAgentMemoryFindMany.mockReset()
  mockAgentMemoryFindMany.mockImplementation(() => Promise.resolve([]))
  mockAgentMemoryUpdate.mockReset()
  mockAgentMemoryUpdate.mockImplementation(() => Promise.resolve({}))
  mockQueryRawUnsafe.mockReset()
  mockQueryRawUnsafe.mockImplementation(() => Promise.resolve([]))
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

describe('saveMemory + searchMemories (text-fallback path)', () => {
  test('saveMemory passes agentId, projectId, category, content to agentMemory.create', async () => {
    mockAgentMemoryCreate.mockImplementationOnce((args: any) => Promise.resolve({ id: 'm1', ...args.data }))
    const { saveMemory } = await import('@/lib/server/memory')
    await saveMemory({
      agentId: 'a1',
      projectId: 'p1',
      category: 'fact',
      content: 'Prod DB is at 10.0.0.5',
    })
    expect(mockAgentMemoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentId: 'a1',
          projectId: 'p1',
          category: 'fact',
          content: 'Prod DB is at 10.0.0.5',
        }),
      })
    )
  })

  test('saveMemory defaults confidence to 0.8 when not provided', async () => {
    mockAgentMemoryCreate.mockImplementationOnce((args: any) => Promise.resolve({ id: 'm1', ...args.data }))
    const { saveMemory } = await import('@/lib/server/memory')
    await saveMemory({ agentId: 'a1', projectId: 'p1', category: 'fact', content: 'x' })
    expect(mockAgentMemoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ confidence: 0.8 }),
      })
    )
  })

  test('saveMemory uses provided confidence when passed', async () => {
    mockAgentMemoryCreate.mockImplementationOnce((args: any) => Promise.resolve({ id: 'm1', ...args.data }))
    const { saveMemory } = await import('@/lib/server/memory')
    await saveMemory({ agentId: 'a1', projectId: 'p1', category: 'fact', content: 'x', confidence: 0.5 })
    expect(mockAgentMemoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ confidence: 0.5 }),
      })
    )
  })

  test('saveMemory stores null embedding when generateEmbedding returns null', async () => {
    mockAgentMemoryCreate.mockImplementationOnce((args: any) => Promise.resolve({ id: 'm1', ...args.data }))
    const { saveMemory } = await import('@/lib/server/memory')
    await saveMemory({ agentId: 'a1', projectId: 'p1', category: 'fact', content: 'x' })
    expect(mockAgentMemoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ embedding: null }),
      })
    )
  })

  test('searchMemories text-matches content in SQLite path', async () => {
    mockAgentMemoryFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { id: 'm1', category: 'fact', content: 'Prod DB is at 10.0.0.5', confidence: 0.8, reinforcement: 1 },
      ])
    )
    const { searchMemories } = await import('@/lib/server/memory')
    const hits = await searchMemories({ agentId: 'a1', projectId: 'p1', query: 'prod database', limit: 5 })
    expect(hits).toHaveLength(1)
    expect(hits[0].content).toContain('Prod DB')
    expect(hits[0].score).toBeNull() // text path doesn't compute a score
  })

  test('searchMemories passes agentId, projectId, and content.contains to findMany', async () => {
    const { searchMemories } = await import('@/lib/server/memory')
    await searchMemories({ agentId: 'a1', projectId: 'p1', query: 'prod', limit: 5 })
    expect(mockAgentMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: 'a1',
          projectId: 'p1',
          content: { contains: 'prod' },
        }),
        take: 5,
      })
    )
  })

  test('searchMemories defaults limit to 5', async () => {
    const { searchMemories } = await import('@/lib/server/memory')
    await searchMemories({ agentId: 'a1', projectId: 'p1', query: 'x' })
    expect(mockAgentMemoryFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })

  test('reinforceMemory increments reinforcement and sets lastAccessed', async () => {
    mockAgentMemoryUpdate.mockImplementationOnce((args: any) =>
      Promise.resolve({ id: 'm1', reinforcement: 2, lastAccessed: new Date() })
    )
    const { reinforceMemory } = await import('@/lib/server/memory')
    await reinforceMemory('m1')
    expect(mockAgentMemoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({
          reinforcement: { increment: 1 },
          lastAccessed: expect.any(Date),
        }),
      })
    )
  })

  test('buildRelevantMemory returns empty string when no hits', async () => {
    mockAgentMemoryFindMany.mockImplementationOnce(() => Promise.resolve([]))
    const { buildRelevantMemory } = await import('@/lib/server/memory')
    const result = await buildRelevantMemory({ agentId: 'a1', projectId: 'p1', query: 'x' })
    expect(result).toBe('')
  })

  test('buildRelevantMemory formats hits with category prefix', async () => {
    mockAgentMemoryFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { id: 'm1', category: 'fact', content: 'Prod DB at 10.0.0.5', confidence: 0.8, reinforcement: 1 },
        { id: 'm2', category: 'preference', content: 'Use TS strict mode', confidence: 0.9, reinforcement: 2 },
      ])
    )
    mockAgentMemoryUpdate.mockImplementation(() => Promise.resolve({}))
    const { buildRelevantMemory } = await import('@/lib/server/memory')
    const result = await buildRelevantMemory({ agentId: 'a1', projectId: 'p1', query: 'x' })
    expect(result).toContain('[fact]')
    expect(result).toContain('Prod DB at 10.0.0.5')
    expect(result).toContain('[preference]')
    expect(result).toContain('Use TS strict mode')
  })

  test('buildRelevantMemory best-effort reinforces each hit', async () => {
    mockAgentMemoryFindMany.mockImplementationOnce(() =>
      Promise.resolve([
        { id: 'm1', category: 'fact', content: 'x', confidence: 0.8, reinforcement: 1 },
        { id: 'm2', category: 'fact', content: 'y', confidence: 0.8, reinforcement: 1 },
      ])
    )
    mockAgentMemoryUpdate.mockImplementation(() => Promise.resolve({}))
    const { buildRelevantMemory } = await import('@/lib/server/memory')
    await buildRelevantMemory({ agentId: 'a1', projectId: 'p1', query: 'x' })
    expect(mockAgentMemoryUpdate).toHaveBeenCalledTimes(2)
  })

  test('buildRelevantMemory does not throw when reinforce fails', async () => {
    mockAgentMemoryFindMany.mockImplementationOnce(() =>
      Promise.resolve([{ id: 'm1', category: 'fact', content: 'x', confidence: 0.8, reinforcement: 1 }])
    )
    mockAgentMemoryUpdate.mockImplementationOnce(() => Promise.reject(new Error('db down')))
    const { buildRelevantMemory } = await import('@/lib/server/memory')
    const result = await buildRelevantMemory({ agentId: 'a1', projectId: 'p1', query: 'x' })
    expect(result).toContain('[fact]') // should still return the formatted block
  })
})
