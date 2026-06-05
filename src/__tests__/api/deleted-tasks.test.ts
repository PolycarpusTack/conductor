import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskUpdate = mock(() => Promise.resolve({})) as any
const mockTaskFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findUnique: mockTaskFindUnique,
      update: mockTaskUpdate,
      findMany: mockTaskFindMany,
    },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined),
  isRealtimeConfigured: () => false,
  createRealtimeToken: () => 'mock-token',
  verifyRealtimeToken: () => null,
}))

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskFindUnique.mockResolvedValue(null)
  mockTaskUpdate.mockReset()
  mockTaskUpdate.mockResolvedValue({})
  mockTaskFindMany.mockReset()
  mockTaskFindMany.mockResolvedValue([])
})

const restoreParams = { params: Promise.resolve({ id: 't-1' }) }

describe('POST /api/tasks/[id]/restore', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/tasks/[id]/restore/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/restore', { method: 'POST', body: {} }),
      restoreParams,
    )
    expect(res.status).toBe(401)
  })

  test('404 for a task that is not deleted', async () => {
    setSession(ADMIN_SESSION)
    mockTaskFindUnique.mockResolvedValue({ id: 't-1', projectId: 'p-1', deletedAt: null })
    const { POST } = await import('@/app/api/tasks/[id]/restore/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/restore', { method: 'POST', body: {} }),
      restoreParams,
    )
    expect(res.status).toBe(404)
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  test('restores a soft-deleted task', async () => {
    setSession(ADMIN_SESSION)
    mockTaskFindUnique.mockResolvedValue({ id: 't-1', projectId: 'p-1', deletedAt: new Date() })
    const { POST } = await import('@/app/api/tasks/[id]/restore/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/restore', { method: 'POST', body: {} }),
      restoreParams,
    )
    expect(res.status).toBe(200)
    expect(mockTaskUpdate.mock.calls[0][0].data).toEqual({ deletedAt: null })
  })
})

describe('GET /api/projects/[id]/deleted-tasks', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/deleted-tasks/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/deleted-tasks'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(401)
  })

  test('lists deleted tasks newest first', async () => {
    setSession(ADMIN_SESSION)
    mockTaskFindMany.mockResolvedValue([
      { id: 't-1', title: 'Oops', status: 'BACKLOG', deletedAt: new Date() },
    ])
    const { GET } = await import('@/app/api/projects/[id]/deleted-tasks/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/deleted-tasks'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tasks).toHaveLength(1)
    const where = mockTaskFindMany.mock.calls[0][0].where
    expect(where).toEqual({ projectId: 'p-1', deletedAt: { not: null } })
  })
})
