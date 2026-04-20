import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/daemon/events/route.ts
//
// Covers the 0.3 security fix — a daemon token from workspace A must NOT be
// able to broadcast events on a task that lives in workspace B, even if it
// happens to know (or guess) the task ID.
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findUnique: mockTaskFindUnique,
    },
  },
}))

const mockResolveDaemonByToken = mock(() => Promise.resolve(null)) as any
const mockExtractDaemonToken = mock(() => 'fake-token') as any

mock.module('@/lib/server/daemon-auth', () => ({
  extractDaemonToken: mockExtractDaemonToken,
  resolveDaemonByToken: mockResolveDaemonByToken,
}))

const mockBroadcastProjectEvent = mock(() => undefined) as any

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcastProjectEvent,
}))

// Import AFTER all mocks are in place
import { POST } from '@/app/api/daemon/events/route'

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockResolveDaemonByToken.mockReset()
  mockExtractDaemonToken.mockReset()
  mockBroadcastProjectEvent.mockReset()

  mockExtractDaemonToken.mockReturnValue('fake-token')
  mockTaskFindUnique.mockResolvedValue(null)
  mockResolveDaemonByToken.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/daemon/events', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer fake-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// ===========================================================================
// POST /api/daemon/events — workspace scoping
// ===========================================================================

describe('POST /api/daemon/events', () => {
  test('rejects with 403 when the task belongs to a different workspace than the daemon', async () => {
    // Daemon token belongs to workspace A; task belongs to workspace B.
    // The handler must refuse to broadcast — prior to 0.3, it happily did.
    mockResolveDaemonByToken.mockResolvedValue({
      id: 'daemon-1',
      workspaceId: 'ws-A',
    })
    mockTaskFindUnique.mockResolvedValue({
      projectId: 'proj-B',
      project: { workspaceId: 'ws-B' },
    })

    const req = makeRequest({
      taskId: 'task-in-ws-b',
      event: { type: 'text', chunk: 'spoofed' },
    })

    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(403)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()

    const json = await res.json()
    expect(json.error).toMatch(/workspace/i)
  })
})
