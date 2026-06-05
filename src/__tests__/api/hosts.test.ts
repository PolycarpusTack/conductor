import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const NOW = new Date()

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
