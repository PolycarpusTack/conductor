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
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any

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
    task: {
      findUnique: mockTaskFindUnique,
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
  mockTaskFindUnique.mockReset()
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockTaskStepUpdateMany.mockResolvedValue({ count: 0 })
  mockActivityLogCreate.mockResolvedValue({})
  mockDaemonFindMany.mockResolvedValue([])
  mockTaskFindUnique.mockResolvedValue({ runtimeOverride: null })
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

  test('leases the step to a daemon in the project workspace', async () => {
    mockTaskStepFindUnique.mockResolvedValue({
      id: 'step-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      status: 'active',
      leasedBy: null,
      leasedAt: null,
      agent: { runtime: { adapter: 'anthropic' } },
      task: { projectId: 'proj-1', project: { workspaceId: 'ws-1' } },
    })
    mockDaemonFindMany.mockResolvedValue([
      {
        id: 'daemon-1',
        hostname: 'host-1',
        workspaceId: 'ws-1',
        capabilities: JSON.stringify({ 'claude-code': true }),
      },
    ])
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    const result = await dispatchStepToDaemon('step-1')

    expect(result).toEqual({ dispatched: true, daemonId: 'daemon-1' })
    // The daemon lookup MUST be scoped to the project's workspace.
    expect(mockDaemonFindMany.mock.calls[0][0].where).toEqual({
      status: 'online',
      workspaceId: 'ws-1',
    })
  })

  test('workspace-less project never leases to a foreign-workspace daemon', async () => {
    mockTaskStepFindUnique.mockResolvedValue({
      id: 'step-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      status: 'active',
      leasedBy: null,
      leasedAt: null,
      agent: { runtime: { adapter: 'anthropic' } },
      task: { projectId: 'proj-1', project: { workspaceId: null } },
    })
    // An online daemon exists in an unrelated workspace — it must NOT be
    // considered. Step prompts/context must never leave the project workspace.
    mockDaemonFindMany.mockResolvedValue([
      {
        id: 'daemon-foreign',
        hostname: 'other-host',
        workspaceId: 'ws-other',
        capabilities: JSON.stringify({ 'claude-code': true }),
      },
    ])

    const result = await dispatchStepToDaemon('step-1')

    expect(result.dispatched).toBe(false)
    expect(result.error).toMatch(/workspace/i)
    // No daemon lookup, no lease.
    expect(mockDaemonFindMany).not.toHaveBeenCalled()
    expect(mockTaskStepUpdateMany).not.toHaveBeenCalled()
    // Durable signal: an activity-log entry explains why dispatch failed.
    expect(mockActivityLogCreate).toHaveBeenCalledTimes(1)
    const logged = mockActivityLogCreate.mock.calls[0][0].data
    expect(logged.action).toBe('daemon_dispatch_failed')
    expect(logged.taskId).toBe('task-1')
    expect(logged.projectId).toBe('proj-1')
    expect(JSON.parse(logged.details)).toMatchObject({
      stepId: 'step-1',
      reason: 'missing_workspace',
    })
  })
})
