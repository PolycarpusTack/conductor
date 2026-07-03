import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHash } from 'crypto'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// Scoped API key fixtures: prefix + SHA-256 hash as stored in the DB.
// KEY_RECORD is bound to proj-1 (B-4); LEGACY_KEY_RECORD is unbound.
const RAW_KEY = 'f'.repeat(64)
const KEY_RECORD = {
  id: 'key-1',
  prefix: RAW_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_KEY).digest('hex'),
  label: 'CI',
  scopes: '["read"]',
  projectId: 'proj-1',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}
const RAW_LEGACY_KEY = 'e'.repeat(64)
const LEGACY_KEY_RECORD = {
  id: 'key-legacy',
  prefix: RAW_LEGACY_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_LEGACY_KEY).digest('hex'),
  label: 'old-CI',
  scopes: '["read"]',
  projectId: null,
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

const mockActivityLogCreate = mock(() => Promise.resolve({})) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    activityLog: {
      findMany: () => Promise.resolve([]),
      create: mockActivityLogCreate,
    },
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) => {
        if (where.prefix === KEY_RECORD.prefix) return Promise.resolve(KEY_RECORD)
        if (where.prefix === LEGACY_KEY_RECORD.prefix) return Promise.resolve(LEGACY_KEY_RECORD)
        return Promise.resolve(null)
      },
      update: () => Promise.resolve(KEY_RECORD),
    },
    // For the route's fire-and-forget purges (retention.ts)
    project: { findUnique: () => Promise.resolve({ artifactRetentionDays: null }) },
    stepArtifact: { deleteMany: () => Promise.resolve({ count: 0 }) },
    task: { deleteMany: () => Promise.resolve({ count: 0 }) },
  },
  isPostgresDb: false,
}))

beforeEach(() => {
  mockActivityLogCreate.mockReset()
  mockActivityLogCreate.mockResolvedValue({})
})

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

describe('GET /api/activity — project-scoped keys (B-4)', () => {
  test('returns 403 when a bound key queries a different project', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(
      makeRequest('http://localhost/api/activity?projectId=proj-2', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(403)
  })

  test('legacy unbound key still reads any project but emits a deprecation warning', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/route')
    const res = await GET(
      makeRequest('http://localhost/api/activity?projectId=proj-2', {
        headers: { authorization: `Bearer ${RAW_LEGACY_KEY}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)

    const deprecation = mockActivityLogCreate.mock.calls.find(
      (call: any[]) => call[0]?.data?.action === 'scoped_key_unbound_deprecated',
    )
    expect(deprecation).toBeDefined()
    expect(deprecation![0].data.projectId).toBe('proj-2')
  })

  test('export route enforces the same binding', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/activity/export/route')
    const denied = await GET(
      makeRequest('http://localhost/api/activity/export?projectId=proj-2', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(denied.status).toBe(403)

    const allowed = await GET(
      makeRequest('http://localhost/api/activity/export?projectId=proj-1', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      { params: Promise.resolve({}) },
    )
    expect(allowed.status).toBe(200)
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
