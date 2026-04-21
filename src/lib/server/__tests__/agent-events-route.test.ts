import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/agent/events/route.ts
//
// POST /api/agent/events — agent-Bearer-authenticated endpoint that mirrors
// /api/daemon/events. HTTP-poll agents use this to emit live activity events
// (thinking, tool_call, tool_result, text, completed, error) so the Kanban-
// side UI can surface them alongside daemon-sourced events.
//
// Covers: missing/invalid auth, cross-project isolation (agent can only emit
// on tasks in its own project), schema validation, stepId belongs to task,
// and the success-path broadcast payload shape.
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskStepFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    task: { findUnique: mockTaskFindUnique },
    taskStep: { findUnique: mockTaskStepFindUnique },
  },
}))

const mockResolveAgentByApiKey = mock(() => Promise.resolve(null)) as any
const mockExtractAgentApiKey = mock(() => 'fake-agent-key') as any

mock.module('@/lib/server/api-keys', () => ({
  extractAgentApiKey: mockExtractAgentApiKey,
  resolveAgentByApiKey: mockResolveAgentByApiKey,
}))

const mockBroadcastProjectEvent = mock(() => undefined) as any

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcastProjectEvent,
}))

// Import AFTER all mocks are in place
import { POST } from '@/app/api/agent/events/route'

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskStepFindUnique.mockReset()
  mockResolveAgentByApiKey.mockReset()
  mockExtractAgentApiKey.mockReset()
  mockBroadcastProjectEvent.mockReset()

  mockExtractAgentApiKey.mockReturnValue('fake-agent-key')
  mockTaskFindUnique.mockResolvedValue(null)
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockResolveAgentByApiKey.mockResolvedValue(null)
})

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/agent/events', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer fake-agent-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/agent/events', () => {
  test('returns 401 when API key is missing', async () => {
    mockExtractAgentApiKey.mockReturnValueOnce(null)

    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(401)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 401 when API key does not resolve to an agent', async () => {
    // resolveAgentByApiKey returns null from beforeEach default.
    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(401)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 400 when event shape is invalid', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })

    const req = makeRequest({ taskId: 't1', event: { type: 'bogus' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(400)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 404 when taskId does not exist', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    // mockTaskFindUnique resolves null from beforeEach default.

    const req = makeRequest({ taskId: 'nope', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(404)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 403 when task belongs to a different project than the agent', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-A' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-B' })

    const req = makeRequest({ taskId: 't1', event: { type: 'thinking' } })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(403)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('returns 404 when stepId is provided but does not belong to the task', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })
    mockTaskStepFindUnique.mockResolvedValue(null)

    const req = makeRequest({
      taskId: 't1',
      stepId: 'ghost-step',
      event: { type: 'thinking' },
    })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(404)
    expect(mockBroadcastProjectEvent).not.toHaveBeenCalled()
  })

  test('broadcasts agent-live-event with correct payload on success', async () => {
    mockResolveAgentByApiKey.mockResolvedValue({ id: 'agent-1', projectId: 'proj-1' })
    mockTaskFindUnique.mockResolvedValue({ id: 't1', projectId: 'proj-1' })
    mockTaskStepFindUnique.mockResolvedValue({ id: 's1', taskId: 't1' })

    const req = makeRequest({
      taskId: 't1',
      stepId: 's1',
      event: { type: 'tool_call', name: 'read_file', args: { path: 'x' } },
    })
    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(200)
    expect(mockBroadcastProjectEvent).toHaveBeenCalledTimes(1)

    const [projectId, eventName, payload] = mockBroadcastProjectEvent.mock.calls[0]
    expect(projectId).toBe('proj-1')
    expect(eventName).toBe('agent-live-event')
    expect(payload).toMatchObject({
      source: 'http',
      agentId: 'agent-1',
      taskId: 't1',
      stepId: 's1',
      event: { type: 'tool_call', name: 'read_file', args: { path: 'x' } },
    })
    expect(typeof payload.timestamp).toBe('string')
  })
})
