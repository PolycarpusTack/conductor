import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// B-2 Claim Lease — route-level behaviour:
// - PUT /api/agent/tasks/[id] action=claim stamps claimExpiresAt
// - POST /api/cli action=claim stamps claimExpiresAt (shared helper)
// - PUT action=complete clears claimExpiresAt
// - POST /api/cli action=done clears claimExpiresAt (chained + non-chained)
//
// Mocked modules: '@/lib/db', '@/lib/server/realtime', and a behaviour-
// compatible '@/lib/server/api-keys' factory (same pattern as
// agent-events-route.test.ts) — bun:test module mocks persist across files,
// so dispatch/memory (which have real unit tests later in the run) are NOT
// module-mocked here.
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskUpdate = mock(() => Promise.resolve({})) as any
const mockTaskUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any
const mockTaskFindMany = mock(() => Promise.resolve([])) as any
const mockTaskStepUpdateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockActivityLogCreate = mock(() => Promise.resolve({})) as any
const mockAgentFindUnique = mock(() => Promise.resolve(null)) as any
const mockAgentUpdate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findUnique: mockTaskFindUnique,
      update: mockTaskUpdate,
      updateMany: mockTaskUpdateMany,
      findMany: mockTaskFindMany,
    },
    taskStep: {
      updateMany: mockTaskStepUpdateMany,
      findMany: mock(() => Promise.resolve([])) as any,
      findFirst: mock(() => Promise.resolve(null)) as any,
      findUnique: mock(() => Promise.resolve(null)) as any,
      update: mock(() => Promise.resolve({})) as any,
    },
    stepReview: { updateMany: mock(() => Promise.resolve({ count: 0 })) as any },
    stepEvent: { create: mock(() => Promise.resolve({})) as any },
    activityLog: { create: mockActivityLogCreate },
    agent: {
      findUnique: mockAgentFindUnique,
      update: mockAgentUpdate,
    },
    agentMemory: { findMany: mock(() => Promise.resolve([])) as any },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined) as any,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))

const mockResolveAgentByApiKey = mock(() =>
  Promise.resolve({ id: 'agent-1', name: 'Agent One', emoji: '🤖', projectId: 'proj-1' }),
) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// this factory must expose the full export surface of the real module with
// behaviour-compatible implementations (mirrors agent-events-route.test.ts).
mock.module('@/lib/server/api-keys', () => ({
  extractAgentApiKey: (request: Request, body?: Record<string, unknown> | null) => {
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    if (bearer) return bearer
    const headerKey = request.headers.get('x-agent-key')?.trim()
    if (headerKey) return headerKey
    return typeof body?.api_key === 'string' ? body.api_key.trim() || null : null
  },
  extractBearerToken: (request: Request) => {
    const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
    return match?.[1]?.trim() || null
  },
  resolveAgentByApiKey: mockResolveAgentByApiKey,
  buildApiKeyPreview: (rawKey: string) => `${rawKey.slice(0, 12)}...${rawKey.slice(-6)}`,
  createAgentApiKey: () => ({ rawKey: 'mock', hash: 'mock', preview: 'mock' }),
  createProjectApiKey: () => ({ rawKey: 'mock', hash: 'mock', preview: 'mock' }),
  getLegacyApiKeyStatus: () => Promise.resolve({ projectsWithPlaintext: 0, agentsWithPlaintext: 0, totalWithPlaintext: 0 }),
  migrateLegacyApiKeys: () => Promise.resolve({ projects: 0, agents: 0 }),
}))

// Import AFTER mocks
import { PUT } from '@/app/api/agent/tasks/[id]/route'
import { POST as cliPost } from '@/app/api/cli/route'
import { resetHeartbeatDebounce } from '@/lib/server/agent-helpers'

const AGENT = { id: 'agent-1', name: 'Agent One', emoji: '🤖', projectId: 'proj-1' }

const BASE_TASK = {
  id: 'task-1',
  title: 'A task',
  description: null,
  notes: null,
  output: null,
  projectId: 'proj-1',
  agentId: 'agent-1',
  status: 'IN_PROGRESS',
  startedAt: new Date(),
  steps: [] as any[],
}

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskUpdate.mockReset()
  mockTaskUpdateMany.mockReset()
  mockTaskFindMany.mockReset()
  mockTaskStepUpdateMany.mockReset()
  mockActivityLogCreate.mockReset()
  mockAgentFindUnique.mockReset()
  mockAgentUpdate.mockReset()

  mockTaskFindUnique.mockResolvedValue({ ...BASE_TASK })
  mockTaskUpdate.mockImplementation(({ data }: any) => Promise.resolve({ ...BASE_TASK, ...data }))
  mockTaskUpdateMany.mockResolvedValue({ count: 1 })
  mockTaskFindMany.mockResolvedValue([])
  mockTaskStepUpdateMany.mockResolvedValue({ count: 0 })
  mockActivityLogCreate.mockResolvedValue({})
  // Real api-keys module: hashed-key lookup resolves our test agent.
  mockAgentFindUnique.mockResolvedValue({ ...AGENT })
  mockAgentUpdate.mockResolvedValue({})
  resetHeartbeatDebounce()
})

function putRequest(body: Record<string, unknown>): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request('http://localhost/api/agent/tasks/task-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-agent-key': 'test-agent-key' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'task-1' }) },
  ]
}

function cliRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/cli', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-key': 'test-agent-key' },
    body: JSON.stringify(body),
  })
}

describe('claim stamps the lease at route level', () => {
  test('PUT /api/agent/tasks/[id] action=claim sets claimExpiresAt', async () => {
    mockTaskFindUnique.mockResolvedValue({ ...BASE_TASK, agentId: null, status: 'BACKLOG' })

    const res = await PUT(...putRequest({ action: 'claim' }))

    expect(res.status).toBe(200)
    expect(mockTaskUpdateMany).toHaveBeenCalled()
    const claimCall = mockTaskUpdateMany.mock.calls.find((c: any) => c[0].data?.status === 'IN_PROGRESS')
    expect(claimCall).toBeDefined()
    expect(claimCall[0].data.claimExpiresAt).toBeInstanceOf(Date)
    expect((claimCall[0].data.claimExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
  })

  test('POST /api/cli action=claim sets claimExpiresAt', async () => {
    mockTaskFindUnique.mockResolvedValue({ ...BASE_TASK, agentId: null, status: 'BACKLOG' })

    const res = await cliPost(cliRequest({ action: 'claim', task_id: 'task-1' }))

    expect(res.status).toBe(200)
    const claimCall = mockTaskUpdateMany.mock.calls.find((c: any) => c[0].data?.status === 'IN_PROGRESS')
    expect(claimCall).toBeDefined()
    expect(claimCall[0].data.claimExpiresAt).toBeInstanceOf(Date)
  })
})

describe('completion clears the lease', () => {
  test('PUT /api/agent/tasks/[id] action=complete clears claimExpiresAt', async () => {
    const res = await PUT(...putRequest({ action: 'complete', output: 'all done' }))

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalled()
    const data = mockTaskUpdate.mock.calls[0][0].data
    expect(data.status).toBe('DONE')
    expect(data.claimExpiresAt).toBeNull()
  })

  test('POST /api/cli action=done clears claimExpiresAt', async () => {
    const res = await cliPost(cliRequest({ action: 'done', task_id: 'task-1', output: 'all done' }))

    expect(res.status).toBe(200)
    expect(mockTaskUpdate).toHaveBeenCalled()
    const data = mockTaskUpdate.mock.calls[0][0].data
    expect(data.status).toBe('DONE')
    expect(data.claimExpiresAt).toBeNull()
  })

  test('chained done clears the lease on the task row (status stays with advanceChain)', async () => {
    // Chained task: the 'done' path saves output on the task without setting
    // DONE (advanceChain owns status) — the claim lease must still be cleared.
    mockTaskFindUnique.mockResolvedValue({
      ...BASE_TASK,
      steps: [{ id: 'step-1', status: 'active', order: 1, agentId: 'agent-1' }],
    })
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    const res = await cliPost(cliRequest({ action: 'done', task_id: 'task-1', output: 'step out' }))

    expect(res.status).toBe(200)
    const data = mockTaskUpdate.mock.calls[0][0].data
    expect(data.claimExpiresAt).toBeNull()
    expect(data.status).toBeUndefined() // advanceChain owns the status here
  })
})
