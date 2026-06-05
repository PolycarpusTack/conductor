import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test targets:
//   src/app/api/daemon/sessions/route.ts            (upsert)
//   src/app/api/daemon/sessions/[sessionId]/events/route.ts (event stream)
//
// Key invariants: session identity derives from the daemon token; a daemon
// can never report a session owned by another daemon; task links must stay
// inside the daemon's workspace.
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockSessionUpsert = mock(() => Promise.resolve({ id: 'sess-1', status: 'starting', backend: 'pty', taskId: null, agentId: null })) as any
const mockSessionFindUnique = mock(() => Promise.resolve(null)) as any
const mockSessionUpdate = mock(() => Promise.resolve({ status: 'active', exitCode: null })) as any

mock.module('@/lib/db', () => ({
  db: {
    task: { findUnique: mockTaskFindUnique },
    agentSession: {
      upsert: mockSessionUpsert,
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
    },
  },
  isPostgresDb: false,
}))

const mockResolveDaemonByToken = mock(() => Promise.resolve(null)) as any
const mockExtractDaemonToken = mock(() => 'fake-token') as any

// NOTE: full export surface — bun's mock.module registry is shared across files
mock.module('@/lib/server/daemon-auth', () => ({
  extractDaemonToken: mockExtractDaemonToken,
  resolveDaemonByToken: mockResolveDaemonByToken,
  generateDaemonToken: () => ({ rawToken: 'mock', hash: 'mock', preview: 'mock' }),
  updateDaemonHeartbeat: () => Promise.resolve(),
  markDaemonOffline: () => Promise.resolve(),
  markStaleDaemons: () => Promise.resolve(),
  sweepStaleDaemonsThrottled: () => Promise.resolve(),
}))

const mockBroadcastProjectEvent = mock(() => undefined) as any

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcastProjectEvent,
  isRealtimeConfigured: () => false,
  createRealtimeToken: () => 'mock-token',
  verifyRealtimeToken: () => null,
}))

// Import AFTER all mocks are in place
import { POST as upsertSession } from '@/app/api/daemon/sessions/route'
import { POST as postSessionEvent } from '@/app/api/daemon/sessions/[sessionId]/events/route'

const DAEMON = { id: 'daemon-1', workspaceId: 'ws-1', hostname: 'devbox', status: 'online', hostId: 'host-1' }

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskFindUnique.mockResolvedValue(null)
  mockSessionUpsert.mockReset()
  mockSessionUpsert.mockResolvedValue({ id: 'sess-1', status: 'starting', backend: 'pty', taskId: null, agentId: null })
  mockSessionFindUnique.mockReset()
  mockSessionFindUnique.mockResolvedValue(null)
  mockSessionUpdate.mockReset()
  mockSessionUpdate.mockResolvedValue({ status: 'active', exitCode: null })
  mockResolveDaemonByToken.mockReset()
  mockResolveDaemonByToken.mockResolvedValue(null)
  mockExtractDaemonToken.mockReset()
  mockExtractDaemonToken.mockReturnValue('fake-token')
  mockBroadcastProjectEvent.mockReset()
})

function makeRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const eventParams = { params: Promise.resolve({ sessionId: 'sess-1' }) }

// ===========================================================================
// POST /api/daemon/sessions
// ===========================================================================

describe('POST /api/daemon/sessions', () => {
  test('401 when token missing', async () => {
    mockExtractDaemonToken.mockReturnValue(null)
    const res = await upsertSession(makeRequest('http://localhost/api/daemon/sessions', {}), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(401)
  })

  test('401 when token invalid', async () => {
    const res = await upsertSession(
      makeRequest('http://localhost/api/daemon/sessions', { sessionKey: 'k', backend: 'pty' }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(401)
  })

  test('400 for malformed payload', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    const res = await upsertSession(
      makeRequest('http://localhost/api/daemon/sessions', { backend: 'teletype' }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(400)
  })

  test('403 when linked task is in another workspace', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockTaskFindUnique.mockResolvedValue({ projectId: 'p-2', project: { workspaceId: 'ws-OTHER' } })
    const res = await upsertSession(
      makeRequest('http://localhost/api/daemon/sessions', { sessionKey: 'k', backend: 'pty', taskId: 't-1' }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(403)
    expect(mockSessionUpsert).not.toHaveBeenCalled()
  })

  test('200 upsert keyed by daemon id + sessionKey, identity from token', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    const res = await upsertSession(
      makeRequest('http://localhost/api/daemon/sessions', {
        sessionKey: 'agent-main',
        backend: 'pty',
        cwd: '/repo',
        // payload tries to spoof another workspace — must be ignored
        workspaceId: 'ws-EVIL',
      }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    const call = mockSessionUpsert.mock.calls[0][0]
    expect(call.where.daemonId_sessionKey).toEqual({ daemonId: 'daemon-1', sessionKey: 'agent-main' })
    expect(call.create.workspaceId).toBe('ws-1')
    expect(call.create.hostId).toBe('host-1')
  })

  test('derives projectId from the linked task and broadcasts session-status', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockTaskFindUnique.mockResolvedValue({ projectId: 'p-1', project: { workspaceId: 'ws-1' } })
    const res = await upsertSession(
      makeRequest('http://localhost/api/daemon/sessions', { sessionKey: 'k', backend: 'tmux', taskId: 't-1' }),
      { params: Promise.resolve({}) },
    )
    expect(res.status).toBe(200)
    expect(mockBroadcastProjectEvent).toHaveBeenCalledTimes(1)
    expect(mockBroadcastProjectEvent.mock.calls[0][0]).toBe('p-1')
    expect(mockBroadcastProjectEvent.mock.calls[0][1]).toBe('session-status')
  })
})

// ===========================================================================
// POST /api/daemon/sessions/[sessionId]/events
// ===========================================================================

describe('POST /api/daemon/sessions/[sessionId]/events', () => {
  const ownedSession = {
    id: 'sess-1',
    daemonId: 'daemon-1',
    workspaceId: 'ws-1',
    projectId: 'p-1',
    taskId: 't-1',
    agentId: null,
    hostId: 'host-1',
    status: 'active',
    outputPreview: null,
    command: null,
    metadata: null,
    endedAt: null,
    exitCode: null,
  }

  test('401 when token missing', async () => {
    mockExtractDaemonToken.mockReturnValue(null)
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', { type: 'status', status: 'idle' }),
      eventParams,
    )
    expect(res.status).toBe(401)
  })

  test('404 for unknown session', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', { type: 'status', status: 'idle' }),
      eventParams,
    )
    expect(res.status).toBe(404)
  })

  test('403 when session is owned by another daemon', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockSessionFindUnique.mockResolvedValue({ ...ownedSession, daemonId: 'daemon-OTHER' })
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', { type: 'status', status: 'idle' }),
      eventParams,
    )
    expect(res.status).toBe(403)
    expect(mockSessionUpdate).not.toHaveBeenCalled()
  })

  test('400 for malformed event', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockSessionFindUnique.mockResolvedValue(ownedSession)
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', { type: 'explode' }),
      eventParams,
    )
    expect(res.status).toBe(400)
  })

  test('200 output event persists redacted tail and broadcasts session-output', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockSessionFindUnique.mockResolvedValue(ownedSession)
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', {
        type: 'output',
        stream: 'stdout',
        chunk: 'deploy with sk-proj-AbCdEf1234567890TUVxyz done',
      }),
      eventParams,
    )
    expect(res.status).toBe(200)
    const update = mockSessionUpdate.mock.calls[0][0]
    expect(update.data.outputPreview).not.toContain('sk-proj-AbCdEf1234567890TUVxyz')
    expect(mockBroadcastProjectEvent).toHaveBeenCalledTimes(1)
    const [projectId, eventName, payload] = mockBroadcastProjectEvent.mock.calls[0]
    expect(projectId).toBe('p-1')
    expect(eventName).toBe('session-output')
    expect(payload.chunk).not.toContain('sk-proj-AbCdEf1234567890TUVxyz')
  })

  test('200 exited status sets endedAt and broadcasts session-status', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockSessionFindUnique.mockResolvedValue(ownedSession)
    mockSessionUpdate.mockResolvedValue({ status: 'exited', exitCode: 0 })
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', {
        type: 'status',
        status: 'exited',
        exitCode: 0,
      }),
      eventParams,
    )
    expect(res.status).toBe(200)
    const update = mockSessionUpdate.mock.calls[0][0]
    expect(update.data.endedAt).toBeInstanceOf(Date)
    expect(update.data.exitCode).toBe(0)
    expect(mockBroadcastProjectEvent.mock.calls[0][1]).toBe('session-status')
  })

  test('skips broadcast for sessions without a project', async () => {
    mockResolveDaemonByToken.mockResolvedValue(DAEMON)
    mockSessionFindUnique.mockResolvedValue({ ...ownedSession, projectId: null })
    const res = await postSessionEvent(
      makeRequest('http://localhost/api/daemon/sessions/sess-1/events', { type: 'status', status: 'idle' }),
      eventParams,
    )
    expect(res.status).toBe(200)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })
})
