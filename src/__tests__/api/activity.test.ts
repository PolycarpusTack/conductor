import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    activityLog: {
      findMany: () => Promise.resolve([]),
    },
  },
  isPostgresDb: false,
}))

// The GET route fire-and-forgets purgeProjectLogs (NOT purgeOldLogs — that's
// the purge route's import)
mock.module('@/lib/server/activity-logger', () => ({
  writeLog: () => Promise.resolve(),
  purgeProjectLogs: () => Promise.resolve(null),
  purgeOldLogs: () => Promise.resolve(5),
}))

describe('GET /api/activity — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(makeRequest('http://localhost/api/activity?projectId=proj-1'), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(401)
  })

  test('returns 200 when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(makeRequest('http://localhost/api/activity?projectId=proj-1'), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(200)
  })

  test('returns 400 for missing projectId when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(makeRequest('http://localhost/api/activity'), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/activity/purge — auth', () => {
  const validBody = { projectId: 'proj-1', retentionDays: 30 }

  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/activity/purge/route')
    const res = await POST(
      makeRequest('http://localhost/api/activity/purge', { method: 'POST', body: validBody }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(401)
  })

  test('returns 403 for cross-origin request when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/activity/purge/route')
    const res = await POST(
      makeRequest('http://localhost/api/activity/purge', {
        method: 'POST',
        body: validBody,
        headers: { origin: 'https://evil.com' },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(403)
  })

  test('returns 200 with deleted count when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/activity/purge/route')
    const res = await POST(
      makeRequest('http://localhost/api/activity/purge', { method: 'POST', body: validBody }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(5)
  })
})
