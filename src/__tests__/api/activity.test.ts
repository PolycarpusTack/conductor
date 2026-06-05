import { describe, test, expect, mock } from 'bun:test'
import { createHash } from 'crypto'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// A known scoped API key fixture: prefix + SHA-256 hash as stored in the DB
const RAW_KEY = 'f'.repeat(64)
const KEY_RECORD = {
  id: 'key-1',
  prefix: RAW_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_KEY).digest('hex'),
  label: 'CI',
  scopes: '["read"]',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    activityLog: {
      findMany: () => Promise.resolve([]),
    },
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) =>
        Promise.resolve(where.prefix === KEY_RECORD.prefix ? KEY_RECORD : null),
      update: () => Promise.resolve(KEY_RECORD),
    },
    // For the route's fire-and-forget purges (retention.ts)
    project: { findUnique: () => Promise.resolve({ artifactRetentionDays: null }) },
    stepArtifact: { deleteMany: () => Promise.resolve({ count: 0 }) },
    task: { deleteMany: () => Promise.resolve({ count: 0 }) },
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

describe('GET /api/activity — scoped API key auth', () => {
  test('returns 200 for a valid key with read scope, no session', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(
      makeRequest('http://localhost/api/activity?projectId=proj-1', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
  })

  test('returns 401 for an unknown key even with a valid session', async () => {
    // A presented bearer token is authoritative — no silent session fallback
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(
      makeRequest('http://localhost/api/activity?projectId=proj-1', {
        headers: { authorization: `Bearer ${'0'.repeat(64)}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(401)
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
