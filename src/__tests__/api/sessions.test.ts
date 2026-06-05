import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const NOW = new Date()

const mockSession = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  projectId: 'p-1',
  agentId: 'agent-1',
  daemonId: 'daemon-1',
  hostId: 'host-1',
  taskId: 't-1',
  stepId: null,
  sessionKey: 'agent-main',
  backend: 'pty',
  cwd: '/repo',
  command: 'bun test',
  status: 'active',
  lastActivityAt: NOW,
  startedAt: NOW,
  endedAt: null,
  exitCode: null,
  outputPreview: 'running...',
  metadata: null,
  host: { id: 'host-1', displayName: 'Dev Box', hostname: 'devbox' },
}

const mockFindMany = mock(() => Promise.resolve([mockSession])) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    agentSession: { findMany: mockFindMany },
  },
  isPostgresDb: false,
}))

describe('GET /api/sessions — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/sessions/route')
    const res = await GET(makeRequest('http://localhost/api/sessions'), { params: Promise.resolve({}) })
    expect(res.status).toBe(401)
  })

  test('returns sessions when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/sessions/route')
    const res = await GET(makeRequest('http://localhost/api/sessions'), { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].sessionKey).toBe('agent-main')
  })

  test('passes taskId and status filters through to the query', async () => {
    setSession(ADMIN_SESSION)
    mockFindMany.mockClear()
    const { GET } = await import('@/app/api/sessions/route')
    const res = await GET(
      makeRequest('http://localhost/api/sessions?taskId=t-1&status=active&limit=10'),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    const call = mockFindMany.mock.calls[0][0]
    expect(call.where).toEqual({ taskId: 't-1', status: 'active' })
    expect(call.take).toBe(10)
  })
})
