import { describe, test, expect, mock } from 'bun:test'
import { createHash } from 'crypto'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const NOW = new Date()

// Scoped API key fixture for the keyed-read path
const RAW_KEY = 'a'.repeat(64)
const KEY_RECORD = {
  id: 'key-1',
  prefix: RAW_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_KEY).digest('hex'),
  label: 'monitoring',
  scopes: '["read"]',
  createdAt: NOW,
  lastUsedAt: null,
  revokedAt: null,
}

const mockHost = {
  id: 'host-1',
  workspaceId: 'ws-1',
  slug: 'inst-abc',
  displayName: 'Dev Box',
  hostname: 'devbox',
  platform: 'linux',
  arch: 'x64',
  labels: '["gpu"]',
  trustLevel: 'local',
  status: 'online',
  lastSeenAt: NOW,
  metadata: null,
  createdAt: NOW,
  updatedAt: NOW,
  daemons: [
    {
      id: 'daemon-1',
      hostname: 'devbox',
      platform: 'linux',
      version: '1.0.0',
      capabilities: '{"claude-code":{"version":"2.0"}}',
      sessionCapabilities: null,
      status: 'online',
      lastSeenAt: NOW,
      tokenPreview: 'cd_daemon...abc',
    },
  ],
}

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    host: {
      findMany: () => Promise.resolve([mockHost]),
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'host-1' ? mockHost : null),
    },
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) =>
        Promise.resolve(where.prefix === KEY_RECORD.prefix ? KEY_RECORD : null),
      update: () => Promise.resolve(KEY_RECORD),
    },
    agentSession: {
      findMany: () => Promise.resolve([]),
    },
  },
  isPostgresDb: false,
}))

describe('GET /api/hosts — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/hosts/route')
    const res = await GET(makeRequest('http://localhost/api/hosts'), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  test('returns hosts with derived status and capability rollup when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/hosts/route')
    const res = await GET(makeRequest('http://localhost/api/hosts'), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hosts).toHaveLength(1)
    expect(body.hosts[0].status).toBe('online')
    expect(body.hosts[0].daemonCount).toBe(1)
    expect(body.hosts[0].capabilities).toEqual(['claude-code'])
    expect(body.hosts[0].labels).toEqual(['gpu'])
  })

  test('returns 200 for a scoped read key without a session', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/hosts/route')
    const res = await GET(
      makeRequest('http://localhost/api/hosts', { headers: { authorization: `Bearer ${RAW_KEY}` } }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
  })
})

describe('GET /api/hosts/[id] — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/hosts/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/hosts/host-1'), {
      params: Promise.resolve({ id: 'host-1' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns host detail with daemons when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/hosts/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/hosts/host-1'), {
      params: Promise.resolve({ id: 'host-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.displayName).toBe('Dev Box')
    expect(body.daemons).toHaveLength(1)
    expect(body.daemons[0].capabilities['claude-code']).toBeDefined()
    expect(body.sessions).toEqual([])
  })

  test('returns 404 for unknown host', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/hosts/[id]/route')
    const res = await GET(makeRequest('http://localhost/api/hosts/nope'), {
      params: Promise.resolve({ id: 'nope' }),
    })
    expect(res.status).toBe(404)
  })
})
