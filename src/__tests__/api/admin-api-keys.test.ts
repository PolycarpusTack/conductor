import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// B-4: POST /api/admin/api-keys accepts an optional projectId that binds the
// issued key to one project. An unknown projectId is a 400.

const mockApiKeyCreate = mock(() => Promise.resolve({ id: 'key-new' })) as any
const mockProjectFindUnique = mock(() => Promise.resolve(null)) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    apiKey: {
      create: mockApiKeyCreate,
      findMany: () => Promise.resolve([]),
      findUnique: () => Promise.resolve(null),
      update: () => Promise.resolve({}),
    },
    project: { findUnique: mockProjectFindUnique },
    activityLog: { create: () => Promise.resolve({}) },
  },
  isPostgresDb: false,
}))

beforeEach(() => {
  setSession(ADMIN_SESSION)
  mockApiKeyCreate.mockReset()
  mockApiKeyCreate.mockResolvedValue({ id: 'key-new' })
  mockProjectFindUnique.mockReset()
  mockProjectFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === 'proj-1' ? { id: 'proj-1' } : null),
  )
})

const noParams = { params: Promise.resolve({}) }

describe('POST /api/admin/api-keys — project binding (B-4)', () => {
  test('returns 400 for an unknown projectId', async () => {
    const { POST } = await import('@/app/api/admin/api-keys/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/api-keys', {
        method: 'POST',
        body: { label: 'ci', scopes: ['write'], projectId: 'proj-nope' },
      }),
      noParams,
    )
    expect(res.status).toBe(400)
    expect(mockApiKeyCreate).not.toHaveBeenCalled()
  })

  test('issues a key bound to an existing project', async () => {
    const { POST } = await import('@/app/api/admin/api-keys/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/api-keys', {
        method: 'POST',
        body: { label: 'ci', scopes: ['write'], projectId: 'proj-1' },
      }),
      noParams,
    )
    expect(res.status).toBe(201)
    const { data } = mockApiKeyCreate.mock.calls[0][0]
    expect(data.projectId).toBe('proj-1')
  })

  test('issues a legacy unbound key when projectId is omitted', async () => {
    const { POST } = await import('@/app/api/admin/api-keys/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/api-keys', {
        method: 'POST',
        body: { label: 'ci', scopes: ['read'] },
      }),
      noParams,
    )
    expect(res.status).toBe(201)
    const { data } = mockApiKeyCreate.mock.calls[0][0]
    expect(data.projectId).toBeNull()
  })
})
