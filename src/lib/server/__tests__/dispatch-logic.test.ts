import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing the module under test
// ---------------------------------------------------------------------------

const mockTaskStepFindMany = mock(() => Promise.resolve([]))
const mockTaskStepFindFirst = mock(() => Promise.resolve(null))
const mockTaskStepFindUnique = mock(() => Promise.resolve(null))
const mockTaskStepUpdate = mock(() => Promise.resolve({}))
const mockTaskStepUpdateMany = mock(() => Promise.resolve({ count: 1 }))
const mockTaskUpdate = mock(() => Promise.resolve({}))

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findMany: mockTaskStepFindMany,
      findFirst: mockTaskStepFindFirst,
      findUnique: mockTaskStepFindUnique,
      update: mockTaskStepUpdate,
      updateMany: mockTaskStepUpdateMany,
    },
    task: {
      update: mockTaskUpdate,
    },
  },
}))

const mockBroadcastProjectEvent = mock(() => Promise.resolve())

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcastProjectEvent,
}))

// Also mock adapters/registry and mcp-resolver so dispatchStep doesn't explode
// when it is called as a fire-and-forget side effect inside startChain / rewindChain
mock.module('@/lib/server/adapters/registry', () => ({
  getAdapter: mock(() => null),
}))

mock.module('@/lib/server/mcp-resolver', () => ({
  resolveMcpTools: mock(() => Promise.resolve([])),
  executeMcpTool: mock(() => Promise.resolve('')),
}))

// Import AFTER all mocks are in place
import { advanceChain, rewindChain, closeChain, startChain } from '../dispatch'
import { db } from '@/lib/db'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    taskId: 'task-1',
    order: 1,
    status: 'done',
    mode: 'develop',
    autoContinue: true,
    output: 'some output',
    error: null,
    rejectionNote: null,
    attempts: 0,
    startedAt: null,
    completedAt: null,
    agentId: 'agent-1',
    agent: { id: 'agent-1', runtimeId: 'runtime-1' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskStepFindMany.mockReset()
  mockTaskStepFindFirst.mockReset()
  mockTaskStepFindUnique.mockReset()
  mockTaskStepUpdate.mockReset()
  mockTaskStepUpdateMany.mockReset()
  mockTaskUpdate.mockReset()
  mockBroadcastProjectEvent.mockReset()

  // Restore sensible defaults so tests that don't set them don't blow up
  mockTaskStepFindMany.mockResolvedValue([])
  mockTaskStepFindFirst.mockResolvedValue(null)
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockTaskStepUpdate.mockResolvedValue({})
  mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })
  mockTaskUpdate.mockResolvedValue({})
})

// ===========================================================================
// advanceChain
// ===========================================================================

describe('advanceChain', () => {
  test('activates next step and marks task IN_PROGRESS when autoContinue is true and next step has a runtime', async () => {
    const doneStep = makeStep({ id: 'step-1', order: 1, status: 'done', autoContinue: true })
    const nextStep = makeStep({ id: 'step-2', order: 2, status: 'pending', autoContinue: false })

    mockTaskStepFindMany.mockResolvedValue([doneStep, nextStep])
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    await advanceChain('task-1', 'proj-1')

    // Should activate the next step
    expect(mockTaskStepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'step-2', status: 'pending' }),
        data: { status: 'active' },
      }),
    )

    // Task should be set to IN_PROGRESS (agent step with runtimeId)
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS' },
      }),
    )
  })

  test('marks task as DONE when last step is done and no next step exists', async () => {
    const onlyStep = makeStep({ id: 'step-1', order: 1, status: 'done', autoContinue: true })
    mockTaskStepFindMany.mockResolvedValue([onlyStep])

    await advanceChain('task-1', 'proj-1')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'DONE' }),
      }),
    )
    expect(mockBroadcastProjectEvent).toHaveBeenCalledWith('proj-1', 'chain-completed', { taskId: 'task-1' })
  })

  test('marks task as WAITING when autoContinue is false on last done step', async () => {
    const doneStep = makeStep({ id: 'step-1', order: 1, status: 'done', autoContinue: false })
    const nextStep = makeStep({ id: 'step-2', order: 2, status: 'pending' })
    mockTaskStepFindMany.mockResolvedValue([doneStep, nextStep])

    await advanceChain('task-1', 'proj-1')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'WAITING' },
      }),
    )
    // The next step must NOT be activated
    expect(mockTaskStepUpdateMany).not.toHaveBeenCalled()
  })

  test('marks task as WAITING when next step is a human step (does not dispatch)', async () => {
    const doneStep = makeStep({ id: 'step-1', order: 1, status: 'done', autoContinue: true })
    const humanStep = makeStep({
      id: 'step-2',
      order: 2,
      status: 'pending',
      mode: 'human',
      agent: null,
      agentId: null,
    })
    mockTaskStepFindMany.mockResolvedValue([doneStep, humanStep])
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    await advanceChain('task-1', 'proj-1')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'WAITING' },
      }),
    )
  })

  test('marks task as WAITING when next step agent has no runtimeId', async () => {
    const doneStep = makeStep({ id: 'step-1', order: 1, status: 'done', autoContinue: true })
    const noRuntimeStep = makeStep({
      id: 'step-2',
      order: 2,
      status: 'pending',
      agent: { id: 'agent-2', runtimeId: null },
    })
    mockTaskStepFindMany.mockResolvedValue([doneStep, noRuntimeStep])
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    await advanceChain('task-1', 'proj-1')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'WAITING' },
      }),
    )
  })

  test('does nothing when there are no done or skipped steps', async () => {
    const pendingStep = makeStep({ id: 'step-1', order: 1, status: 'pending' })
    mockTaskStepFindMany.mockResolvedValue([pendingStep])

    await advanceChain('task-1', 'proj-1')

    expect(mockTaskUpdate).not.toHaveBeenCalled()
    expect(mockTaskStepUpdateMany).not.toHaveBeenCalled()
  })

  test('counts skipped steps as done when finding last completed step', async () => {
    const skippedStep = makeStep({ id: 'step-1', order: 1, status: 'skipped', autoContinue: true })
    mockTaskStepFindMany.mockResolvedValue([skippedStep])

    await advanceChain('task-1', 'proj-1')

    // No next step → task DONE
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DONE' }),
      }),
    )
  })
})

// ===========================================================================
// rewindChain
// ===========================================================================

describe('rewindChain', () => {
  test('resets target step to active with rejection note and increments attempts', async () => {
    const targetStep = makeStep({ id: 'step-2', order: 2, status: 'done', agent: { id: 'agent-1', runtimeId: null } })
    mockTaskStepFindUnique.mockResolvedValue(targetStep)

    await rewindChain('task-1', 'proj-1', 'step-2', 'Please redo this step')

    expect(mockTaskStepUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-2' },
        data: expect.objectContaining({
          status: 'active',
          output: null,
          error: null,
          rejectionNote: 'Please redo this step',
          attempts: { increment: 1 },
          startedAt: null,
          completedAt: null,
        }),
      }),
    )
  })

  test('resets all steps after target back to pending', async () => {
    const targetStep = makeStep({ id: 'step-2', order: 2, status: 'done', agent: { id: 'agent-1', runtimeId: null } })
    mockTaskStepFindUnique.mockResolvedValue(targetStep)

    await rewindChain('task-1', 'proj-1', 'step-2', 'Rejected')

    expect(mockTaskStepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: 'task-1',
          order: { gt: 2 },
        }),
        data: expect.objectContaining({
          status: 'pending',
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
        }),
      }),
    )
  })

  test('moves task to IN_PROGRESS after rewind', async () => {
    const targetStep = makeStep({ id: 'step-2', order: 2, status: 'done', agent: { id: 'agent-1', runtimeId: null } })
    mockTaskStepFindUnique.mockResolvedValue(targetStep)

    await rewindChain('task-1', 'proj-1', 'step-2', 'Rejected')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS' },
      }),
    )
  })

  test('broadcasts chain-rewound event', async () => {
    const targetStep = makeStep({ id: 'step-2', order: 2, status: 'done', agent: { id: 'agent-1', runtimeId: null } })
    mockTaskStepFindUnique.mockResolvedValue(targetStep)

    await rewindChain('task-1', 'proj-1', 'step-2', 'Try again')

    expect(mockBroadcastProjectEvent).toHaveBeenCalledWith('proj-1', 'chain-rewound', {
      taskId: 'task-1',
      targetStepId: 'step-2',
      rejectionNote: 'Try again',
    })
  })

  test('throws when target step is not found', async () => {
    mockTaskStepFindUnique.mockResolvedValue(null)

    await expect(rewindChain('task-1', 'proj-1', 'nonexistent', 'note')).rejects.toThrow('Target step not found')
  })
})

// ===========================================================================
// closeChain
// ===========================================================================

describe('closeChain', () => {
  test('marks remaining pending and active steps as skipped', async () => {
    await closeChain('task-1', 'proj-1', 'No longer needed')

    expect(mockTaskStepUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: 'task-1',
          status: { in: ['pending', 'active'] },
        }),
        data: { status: 'skipped' },
      }),
    )
  })

  test('sets task status to DONE with completedAt and close note in output', async () => {
    await closeChain('task-1', 'proj-1', 'Cancelled by user')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'DONE',
          output: 'Chain closed: Cancelled by user',
        }),
      }),
    )

    const callArgs = mockTaskUpdate.mock.calls[0][0] as { data: { completedAt?: Date } }
    expect(callArgs.data.completedAt).toBeInstanceOf(Date)
  })

  test('broadcasts chain-completed event with closed flag and note', async () => {
    await closeChain('task-1', 'proj-1', 'Done early')

    expect(mockBroadcastProjectEvent).toHaveBeenCalledWith('proj-1', 'chain-completed', {
      taskId: 'task-1',
      closed: true,
      note: 'Done early',
    })
  })
})

// ===========================================================================
// startChain
// ===========================================================================

describe('startChain', () => {
  test('does nothing when no first step exists', async () => {
    mockTaskStepFindFirst.mockResolvedValue(null)

    await startChain('task-1', 'proj-1')

    expect(mockTaskStepUpdateMany).not.toHaveBeenCalled()
    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  test('does nothing when step is already activated by another caller (count 0)', async () => {
    const firstStep = makeStep({ id: 'step-1', order: 1, status: 'pending', mode: 'develop' })
    mockTaskStepFindFirst.mockResolvedValue(firstStep)
    mockTaskStepUpdateMany.mockResolvedValue({ count: 0 })

    await startChain('task-1', 'proj-1')

    expect(mockTaskUpdate).not.toHaveBeenCalled()
  })

  test('sets task to WAITING when first step is a human step', async () => {
    const humanStep = makeStep({ id: 'step-1', order: 1, status: 'pending', mode: 'human', agent: null })
    mockTaskStepFindFirst.mockResolvedValue(humanStep)
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    await startChain('task-1', 'proj-1')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: { status: 'WAITING' },
      }),
    )
  })

  test('broadcasts step-activated event after activating first step', async () => {
    const firstStep = makeStep({ id: 'step-1', order: 1, status: 'pending', mode: 'develop' })
    mockTaskStepFindFirst.mockResolvedValue(firstStep)
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    await startChain('task-1', 'proj-1')

    expect(mockBroadcastProjectEvent).toHaveBeenCalledWith('proj-1', 'step-activated', {
      taskId: 'task-1',
      stepId: 'step-1',
    })
  })

  test('dispatches step (fires dispatchStep) when first agent step has a runtimeId', async () => {
    const agentStep = makeStep({
      id: 'step-1',
      order: 1,
      status: 'pending',
      mode: 'develop',
      agent: { id: 'agent-1', runtimeId: 'runtime-1' },
    })
    mockTaskStepFindFirst.mockResolvedValue(agentStep)
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    // dispatchStep will call db.taskStep.findUnique internally; return null so it exits early
    mockTaskStepFindUnique.mockResolvedValue(null)

    // Should not throw
    await expect(startChain('task-1', 'proj-1')).resolves.toBeUndefined()

    // step-activated broadcast happened
    expect(mockBroadcastProjectEvent).toHaveBeenCalledWith('proj-1', 'step-activated', {
      taskId: 'task-1',
      stepId: 'step-1',
    })
  })
})
