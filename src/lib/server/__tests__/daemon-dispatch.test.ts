import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing the module under test.
//
// We test only the early-bail behaviour of dispatchStepToDaemon — specifically
// that a step with a still-fresh lease is rejected without touching the
// daemon/runtime lookup path. The remaining branches (resolve runtime, find
// daemon, take lease, broadcast) are better covered by integration tests
// that stand up a real Prisma client.
// ---------------------------------------------------------------------------

const mockTaskStepFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskStepUpdateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockActivityLogCreate = mock(() => Promise.resolve({})) as any
const mockDaemonFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findUnique: mockTaskStepFindUnique,
      updateMany: mockTaskStepUpdateMany,
    },
    activityLog: {
      create: mockActivityLogCreate,
    },
    daemon: {
      findMany: mockDaemonFindMany,
    },
  },
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => Promise.resolve()) as any,
}))

// Import AFTER all mocks are in place
import { dispatchStepToDaemon } from '../daemon-dispatch'

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskStepFindUnique.mockReset()
  mockTaskStepUpdateMany.mockReset()
  mockActivityLogCreate.mockReset()
  mockDaemonFindMany.mockReset()
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockTaskStepUpdateMany.mockResolvedValue({ count: 0 })
  mockActivityLogCreate.mockResolvedValue({})
  mockDaemonFindMany.mockResolvedValue([])
})

// ===========================================================================
// dispatchStepToDaemon
// ===========================================================================

describe('dispatchStepToDaemon', () => {
  test('rejects a step that still carries a fresh lease', async () => {
    // A fresh lease (leasedAt === now) means the previous daemon is still
    // alive and should finish the step. Stealing it would double-execute.
    mockTaskStepFindUnique.mockResolvedValue({
      id: 'step-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      status: 'active',
      leasedBy: 'daemon-other',
      leasedAt: new Date(), // fresh
      agent: { runtime: { adapter: 'anthropic' } },
      task: { projectId: 'proj-1', project: { workspaceId: 'ws-1' } },
    })

    const result = await dispatchStepToDaemon('step-1')

    expect(result).toEqual({ dispatched: false, error: 'Step already leased' })

    // Must bail BEFORE touching runtime/daemon lookup or lease state.
    expect(mockDaemonFindMany).not.toHaveBeenCalled()
    expect(mockTaskStepUpdateMany).not.toHaveBeenCalled()
    expect(mockActivityLogCreate).not.toHaveBeenCalled()
  })
})
