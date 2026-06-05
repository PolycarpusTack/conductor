import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const mockProject = {
  id: 'proj-1',
  name: 'Test',
  description: null,
  color: '#3b82f6',
  agents: [],
  tasks: [],
}

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    project: {
      findUnique: () => Promise.resolve(mockProject),
      update: () => Promise.resolve(mockProject),
      delete: () => Promise.resolve({}),
    },
  },
  isPostgresDb: false,
}))

const projectParams = { params: Promise.resolve({ id: 'proj-1' }) }

describe('GET /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/projects/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { PUT } = await import('@/app/api/projects/[id]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/proj-1', { method: 'PUT', body: { name: 'Updated' } }),
      projectParams,
    )
    expect(res.status).toBe(401)
  })

  test('returns 403 for cross-origin request when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { PUT } = await import('@/app/api/projects/[id]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/proj-1', {
        method: 'PUT',
        body: { name: 'Updated' },
        headers: { origin: 'https://evil.com' },
      }),
      projectParams,
    )
    expect(res.status).toBe(403)
  })

  test('returns 200 when authenticated same-origin', async () => {
    setSession(ADMIN_SESSION)
    const { PUT } = await import('@/app/api/projects/[id]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/proj-1', { method: 'PUT', body: { name: 'Updated' } }),
      projectParams,
    )
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/projects/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { DELETE } = await import('@/app/api/projects/[id]/route')
    const res = await DELETE(makeRequest('http://localhost/api/projects/proj-1'), projectParams)
    expect(res.status).toBe(401)
  })

  test('returns 403 for cross-origin request when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { DELETE } = await import('@/app/api/projects/[id]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/proj-1', {
        method: 'DELETE',
        headers: { origin: 'https://evil.com' },
      }),
      projectParams,
    )
    expect(res.status).toBe(403)
  })

  test('returns 200 when authenticated same-origin', async () => {
    setSession(ADMIN_SESSION)
    const { DELETE } = await import('@/app/api/projects/[id]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/proj-1', { method: 'DELETE' }),
      projectParams,
    )
    expect(res.status).toBe(200)
  })
})
