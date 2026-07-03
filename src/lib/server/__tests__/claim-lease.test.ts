import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// ---------------------------------------------------------------------------
// B-2 Claim Lease — unit tests on the shared agent-helpers claim/heartbeat
// path (both PUT /api/agent/tasks/[id] and /api/cli delegate here).
//
// Covers:
// - claimOrStartTask stamps claimExpiresAt = now + window (default 15 min)
// - the window is configurable via AGENTBOARD_CLAIM_LEASE_MS
// - updateAgentHeartbeat renews claims ONLY on tasks claimed by that agent,
//   inside the existing debounced write (no write per request)
//
// Only '@/lib/db' and '@/lib/server/realtime' are module-mocked — bun:test
// module mocks persist across files, and dispatch/memory/api-keys have real
// unit tests elsewhere in the run (see dispatch-logic.test.ts note).
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any
const mockTaskFindMany = mock(() => Promise.resolve([])) as any
const mockActivityLogCreate = mock(() => Promise.resolve({})) as any
const mockAgentUpdate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findUnique: mockTaskFindUnique,
      updateMany: mockTaskUpdateMany,
      findMany: mockTaskFindMany,
    },
    activityLog: { create: mockActivityLogCreate },
    agent: { update: mockAgentUpdate },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined) as any,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))

// Import AFTER mocks — real module under test (real dispatch loads with the
// mocked db; startChain is never invoked because fixtures have no steps).
import {
  claimOrStartTask,
  updateAgentHeartbeat,
  resetHeartbeatDebounce,
  DEFAULT_CLAIM_LEASE_MS,
} from '../agent-helpers'

const AGENT = { id: 'agent-1', name: 'Agent One', emoji: '🤖', projectId: 'proj-1' }

const EXISTING_TASK = {
  id: 'task-1',
  projectId: 'proj-1',
  agentId: null,
  status: 'BACKLOG',
  startedAt: null,
  steps: [],
}

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskUpdateMany.mockReset()
  mockTaskFindMany.mockReset()
  mockActivityLogCreate.mockReset()
  mockAgentUpdate.mockReset()

  // findUnique is called twice by claimOrStartTask (pre-check + reload)
  mockTaskFindUnique.mockResolvedValue({ ...EXISTING_TASK })
  mockTaskUpdateMany.mockResolvedValue({ count: 1 })
  mockTaskFindMany.mockResolvedValue([])
  mockActivityLogCreate.mockResolvedValue({})
  mockAgentUpdate.mockResolvedValue({})

  resetHeartbeatDebounce()
  delete process.env.AGENTBOARD_CLAIM_LEASE_MS
})

afterEach(() => {
  delete process.env.AGENTBOARD_CLAIM_LEASE_MS
})

describe('claimOrStartTask — claim sets the lease', () => {
  test('claim stamps claimExpiresAt = now + default window (15 min)', async () => {
    const before = Date.now()
    const result = await claimOrStartTask('task-1', AGENT, 'claimed')
    const after = Date.now()

    expect('error' in result).toBe(false)
    expect(mockTaskUpdateMany).toHaveBeenCalled()
    const data = mockTaskUpdateMany.mock.calls[0][0].data
    expect(data.status).toBe('IN_PROGRESS')
    expect(data.claimExpiresAt).toBeInstanceOf(Date)
    const expiry = (data.claimExpiresAt as Date).getTime()
    expect(expiry).toBeGreaterThanOrEqual(before + DEFAULT_CLAIM_LEASE_MS)
    expect(expiry).toBeLessThanOrEqual(after + DEFAULT_CLAIM_LEASE_MS)
    expect(DEFAULT_CLAIM_LEASE_MS).toBe(15 * 60_000)
  })

  test('start also stamps the lease (same Model-B ownership path)', async () => {
    await claimOrStartTask('task-1', AGENT, 'started')
    const data = mockTaskUpdateMany.mock.calls[0][0].data
    expect(data.claimExpiresAt).toBeInstanceOf(Date)
  })

  test('window is configurable via AGENTBOARD_CLAIM_LEASE_MS', async () => {
    process.env.AGENTBOARD_CLAIM_LEASE_MS = '60000' // 1 min
    const before = Date.now()
    await claimOrStartTask('task-1', AGENT, 'claimed')
    const after = Date.now()

    const expiry = (mockTaskUpdateMany.mock.calls[0][0].data.claimExpiresAt as Date).getTime()
    expect(expiry).toBeGreaterThanOrEqual(before + 60_000)
    expect(expiry).toBeLessThanOrEqual(after + 60_000)
  })
})

describe('updateAgentHeartbeat — renewal', () => {
  test('heartbeat renews claims only on tasks claimed by that agent', async () => {
    const before = Date.now()
    const didWrite = await updateAgentHeartbeat('agent-1')
    const after = Date.now()

    expect(didWrite).toBe(true)
    expect(mockTaskUpdateMany).toHaveBeenCalledTimes(1)
    const call = mockTaskUpdateMany.mock.calls[0][0]
    // Renew ONLY this agent's in-progress Model-B claims — never other
    // agents' tasks, never dispatch-driven tasks (claimExpiresAt null).
    expect(call.where).toEqual({
      agentId: 'agent-1',
      status: 'IN_PROGRESS',
      claimExpiresAt: { not: null },
    })
    const expiry = (call.data.claimExpiresAt as Date).getTime()
    expect(expiry).toBeGreaterThanOrEqual(before + DEFAULT_CLAIM_LEASE_MS)
    expect(expiry).toBeLessThanOrEqual(after + DEFAULT_CLAIM_LEASE_MS)
  })

  test('renewal stays inside the debounce — second heartbeat writes nothing', async () => {
    await updateAgentHeartbeat('agent-1')
    mockAgentUpdate.mockClear()
    mockTaskUpdateMany.mockClear()

    const didWrite = await updateAgentHeartbeat('agent-1')

    expect(didWrite).toBe(false)
    expect(mockAgentUpdate).not.toHaveBeenCalled()
    expect(mockTaskUpdateMany).not.toHaveBeenCalled()
  })
})
