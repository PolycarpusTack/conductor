import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/tasks/route.ts (POST)
//
// Covers the 0.3 DAG validation fix — when a task is created with step edges
// that reference a client-side ID (`step_N`) the route never materialised,
// the handler must reject the request with 400 instead of silently writing
// a dangling edge to the database (which used to persist and strand the task
// because the workflow engine could never find the target step).
// ---------------------------------------------------------------------------

// Transaction mock — the route body runs most of its logic inside a
// $transaction callback. We construct a `tx` shape that satisfies every
// method the route touches before the remapOrFail throw point.
const mockTxTaskFindFirst = mock(() => Promise.resolve(null)) as any
const mockTxTaskCreate = mock(() => Promise.resolve({ id: 'task-new' })) as any
const mockTxTaskStepCreateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockTxTaskStepFindMany = mock(() => Promise.resolve([])) as any
const mockTxTaskStepUpdate = mock(() => Promise.resolve({})) as any
const mockTxTaskFindUniqueOrThrow = mock(() => Promise.resolve({})) as any

const txShape = {
  task: {
    findFirst: mockTxTaskFindFirst,
    create: mockTxTaskCreate,
    findUniqueOrThrow: mockTxTaskFindUniqueOrThrow,
  },
  taskStep: {
    createMany: mockTxTaskStepCreateMany,
    findMany: mockTxTaskStepFindMany,
    update: mockTxTaskStepUpdate,
  },
}

const mockTransaction = mock((cb: (tx: typeof txShape) => unknown) => cb(txShape)) as any
const mockAgentFindUnique = mock(() => Promise.resolve(null)) as any
const mockAgentFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    $transaction: mockTransaction,
    agent: {
      findUnique: mockAgentFindUnique,
      findMany: mockAgentFindMany,
    },
    task: {
      findMany: mock(() => Promise.resolve([])) as any,
      count: mock(() => Promise.resolve(0)) as any,
    },
  },
}))

// Admin auth is bypassed for the test — we're testing payload validation,
// not the session layer.
mock.module('@/lib/server/admin-session', () => ({
  requireAdminSession: mock(() => Promise.resolve(null)) as any,
}))

// `normalizeDagEdges` is called after the transaction commits. Our test
// throws badRequest *inside* the transaction, so it never runs — but mock
// it anyway so the module resolution succeeds.
mock.module('@/lib/server/dispatch', () => ({
  normalizeDagEdges: mock(() => Promise.resolve()) as any,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined) as any,
}))

// Import AFTER all mocks are in place
import { POST } from '@/app/api/tasks/route'

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTxTaskFindFirst.mockReset()
  mockTxTaskCreate.mockReset()
  mockTxTaskStepCreateMany.mockReset()
  mockTxTaskStepFindMany.mockReset()
  mockTxTaskStepUpdate.mockReset()
  mockTxTaskFindUniqueOrThrow.mockReset()
  mockTransaction.mockReset()
  mockAgentFindUnique.mockReset()
  mockAgentFindMany.mockReset()

  // Default behaviours — a clean transaction path up to the remap loop.
  mockTxTaskFindFirst.mockResolvedValue(null)
  mockTxTaskCreate.mockResolvedValue({ id: 'task-new', projectId: 'proj-1' })
  mockTxTaskStepCreateMany.mockResolvedValue({ count: 3 })
  // findMany returns the just-created steps with real DB IDs in order.
  mockTxTaskStepFindMany.mockResolvedValue([
    { id: 'db-step-0', order: 1 },
    { id: 'db-step-1', order: 2 },
    { id: 'db-step-2', order: 3 },
  ])
  mockTxTaskStepUpdate.mockResolvedValue({})
  mockTxTaskFindUniqueOrThrow.mockResolvedValue({ id: 'task-new' })
  mockTransaction.mockImplementation((cb: (tx: typeof txShape) => unknown) => cb(txShape))
  mockAgentFindMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ===========================================================================
// POST /api/tasks — DAG edge validation
// ===========================================================================

describe('POST /api/tasks — DAG edge remap', () => {
  test('rejects a step edge that targets a client step ID we never created', async () => {
    // step_0 points at step_99 — but only step_0..step_2 exist. Prior to the
    // 0.3 fix, the route silently wrote the dangling `step_99` string to the
    // DB and the resulting task was unrunnable.
    const req = makeRequest({
      title: 'dag test',
      projectId: 'proj-1',
      steps: [
        { mode: 'analyze', nextSteps: [{ targetStepId: 'step_99' }] },
        { mode: 'develop' },
        { mode: 'review' },
      ],
    })

    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(400)

    const json = await res.json()
    expect(json.error).toMatch(/unknown step reference/i)
    expect(json.error).toMatch(/step_99/)

    // The route must not have persisted any edge — the transaction body
    // threw inside the remap loop before reaching tx.taskStep.update, and
    // $transaction is expected to roll back.
    expect(mockTxTaskStepUpdate).not.toHaveBeenCalled()
  })

  test('accepts a step edge that targets a real peer step (step_1)', async () => {
    // Sanity check that well-formed input still works — otherwise the strict
    // validation would reject valid DAGs. step_0 -> step_1 is fine.
    const req = makeRequest({
      title: 'dag ok',
      projectId: 'proj-1',
      steps: [
        { mode: 'analyze', nextSteps: [{ targetStepId: 'step_1' }] },
        { mode: 'develop' },
      ],
    })

    // Update findMany to match the 2-step payload for this case
    mockTxTaskStepFindMany.mockResolvedValue([
      { id: 'db-step-0', order: 1 },
      { id: 'db-step-1', order: 2 },
    ])

    const res = await POST(req, { params: Promise.resolve({}) } as any)

    expect(res.status).toBe(200)

    // step_0's edge was remapped to the real DB ID of step_1
    const updateCall = mockTxTaskStepUpdate.mock.calls.find((call: any[]) =>
      call[0]?.where?.id === 'db-step-0',
    )
    expect(updateCall).toBeDefined()
    const nextStepsJson = updateCall![0].data.nextSteps as string
    expect(nextStepsJson).toContain('db-step-1')
    expect(nextStepsJson).not.toContain('step_1')
  })
})
