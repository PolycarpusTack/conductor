import { describe, test, expect, mock } from 'bun:test'
import { createHash } from 'crypto'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// B-4: /api/projects/[id]/analytics accepts scoped read keys — a key bound to
// project P must not read analytics of project Q.

const RAW_KEY = '9'.repeat(64)
const KEY_RECORD = {
  id: 'key-analytics',
  prefix: RAW_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_KEY).digest('hex'),
  label: 'dashboard',
  scopes: '["read"]',
  projectId: 'proj-1',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) =>
        Promise.resolve(where.prefix === KEY_RECORD.prefix ? KEY_RECORD : null),
      update: () => Promise.resolve(KEY_RECORD),
    },
    activityLog: { create: () => Promise.resolve({}) },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/analytics', () => ({
  getProjectStats: () => Promise.resolve({ tasks: 0 }),
  getAgentScorecard: () => Promise.resolve([]),
  getRuntimeStats: () => Promise.resolve([]),
  getFailureClusters: () => Promise.resolve([]),
  getChainBottlenecks: () => Promise.resolve([]),
}))

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/projects/[id]/analytics — project-scoped keys (B-4)', () => {
  test('returns 200 for a bound key reading its own project', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/analytics/route')
    const res = await GET(
      makeRequest('http://localhost/api/projects/proj-1/analytics', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      paramsFor('proj-1'),
    )
    expect(res.status).toBe(200)
  })

  test('returns 403 for a bound key reading a different project', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/analytics/route')
    const res = await GET(
      makeRequest('http://localhost/api/projects/proj-2/analytics', {
        headers: { authorization: `Bearer ${RAW_KEY}` },
      }),
      paramsFor('proj-2'),
    )
    expect(res.status).toBe(403)
  })

  test('admin session reads any project regardless of key bindings', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/projects/[id]/analytics/route')
    const res = await GET(
      makeRequest('http://localhost/api/projects/proj-2/analytics'),
      paramsFor('proj-2'),
    )
    expect(res.status).toBe(200)
  })
})
