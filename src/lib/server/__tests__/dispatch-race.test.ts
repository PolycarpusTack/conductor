import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

// ===========================================================================
// B-1 / B-6-T1 — dispatchStep race hardening.
//
// Reproduces the double-dispatch bug: pollAndDispatch selects steps BEFORE
// they are leased; when the expensive prelude (memory build, MCP resolution)
// outlasts the poll interval, a second dispatchStep starts for the same step.
// WORKER_ID is per-process and leaseStep permits re-taking one's own lease,
// so both invocations pass the lease; the (stepId, attempt) unique constraint
// only saves us when both racy count() reads produce the same number.
//
// The db is a small stateful fake mocked via mock.module (established
// pattern — bun's module registry is shared across test files, so all mocks
// are file-scoped functions reset in beforeEach). Collaborators that have
// their own real-module suites (adapter registry, memory, mcp-resolver) are
// substituted through the dispatchDeps seams instead of mock.module.
// ===========================================================================

// ---------------------------------------------------------------------------
// Stateful fake db
// ---------------------------------------------------------------------------

type ExecutionRow = { id: string; stepId: string; attempt: number; status: string }

const state = {
  stepStatus: 'active' as string,
  leasedBy: null as string | null,
  leasedAt: null as Date | null,
  agentMissing: false,
  activeAgentSteps: 0,
  maxConcurrent: 3,
  executions: [] as ExecutionRow[],
  // When true, the attempt-number reads (count / max-attempt lookup) return
  // stale "no executions" answers even though rows exist — simulating the
  // racy read that lets two dispatchers derive attempt numbers independently.
  staleAttemptReads: false,
  ops: [] as string[], // ordered high-level operations
  stepEvents: [] as Array<{ event: string; data: Record<string, unknown> | null }>,
}

function resetState() {
  state.stepStatus = 'active'
  state.leasedBy = null
  state.leasedAt = null
  state.agentMissing = false
  state.activeAgentSteps = 0
  state.maxConcurrent = 3
  state.executions = []
  state.staleAttemptReads = false
  state.ops = []
  state.stepEvents = []
}

function fullStep() {
  return {
    id: 'step-1',
    taskId: 'task-1',
    order: 1,
    status: state.stepStatus,
    mode: 'develop',
    instructions: 'do the thing',
    prevSteps: null,
    nextSteps: null,
    isMergePoint: false,
    rejectionNote: null,
    attempts: 0,
    timeoutMs: 60000,
    maxRetries: 2,
    retryDelayMs: 0,
    fallbackAgentId: null,
    traceContext: null,
    autoContinue: true,
    agentId: 'agent-1',
    leasedBy: state.leasedBy,
    leasedAt: state.leasedAt,
    task: { id: 'task-1', projectId: 'proj-1', title: 'Race task', description: null },
    agent: state.agentMissing
      ? null
      : {
          id: 'agent-1',
          projectId: 'proj-1',
          runtimeId: 'rt-1',
          maxConcurrent: state.maxConcurrent,
          name: 'Agent',
          role: null,
          capabilities: null,
          personality: null,
          systemPrompt: '',
          modeInstructions: null,
          mcpConnectionIds: null,
          runtimeModel: null,
          invocationMode: 'HTTP',
        },
  }
}

const mockTaskStepFindUnique = mock((args: any) => {
  if (args?.select?.leasedBy) return Promise.resolve({ leasedBy: state.leasedBy })
  return Promise.resolve(fullStep())
}) as any

const mockTaskStepUpdateMany = mock((args: any) => {
  const data = args?.data ?? {}
  // Lease acquisition (leaseStep): emulate Prisma where-semantics — status
  // must be active and the lease must be free, ours already, or expired.
  if (typeof data.leasedBy === 'string') {
    const canLease =
      state.stepStatus === 'active' &&
      (state.leasedBy === null || state.leasedBy === data.leasedBy)
    if (!canLease) return Promise.resolve({ count: 0 })
    state.leasedBy = data.leasedBy
    state.leasedAt = data.leasedAt ?? new Date()
    state.ops.push('lease-taken')
    return Promise.resolve({ count: 1 })
  }
  // Lease release
  if ('leasedBy' in data && data.leasedBy === null) {
    if (args?.where?.leasedBy && args.where.leasedBy !== state.leasedBy) {
      return Promise.resolve({ count: 0 })
    }
    state.leasedBy = null
    state.leasedAt = null
    state.ops.push('lease-released')
    return Promise.resolve({ count: 1 })
  }
  return Promise.resolve({ count: 1 })
}) as any

const mockTaskStepUpdate = mock((args: any) => {
  const data = args?.data ?? {}
  if (typeof data.status === 'string') {
    state.stepStatus = data.status
    state.ops.push(`step-status:${data.status}`)
  }
  if ('leasedBy' in data) state.leasedBy = data.leasedBy
  if ('leasedAt' in data) state.leasedAt = data.leasedAt
  return Promise.resolve(fullStep())
}) as any

const mockTaskStepCount = mock(() => Promise.resolve(state.activeAgentSteps)) as any
const mockTaskStepFindFirst = mock(() => Promise.resolve(null)) as any
const mockTaskStepFindMany = mock(() => Promise.resolve([])) as any

const mockRuntimeFindUnique = mock(() =>
  Promise.resolve({ id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null }),
) as any
const mockProjectModeFindFirst = mock(() => Promise.resolve(null)) as any

const mockExecutionCount = mock(() =>
  Promise.resolve(state.staleAttemptReads ? 0 : state.executions.length),
) as any
const mockExecutionFindFirst = mock(() => {
  if (state.staleAttemptReads || state.executions.length === 0) return Promise.resolve(null)
  const latest = [...state.executions].sort((a, b) => b.attempt - a.attempt)[0]
  return Promise.resolve(latest)
}) as any
const mockExecutionFindUnique = mock(() => Promise.resolve({ startedAt: new Date() })) as any
const mockExecutionCreate = mock((args: any) => {
  const { stepId, attempt } = args.data
  if (state.executions.some((e) => e.stepId === stepId && e.attempt === attempt)) {
    // Prisma unique-constraint violation on (stepId, attempt)
    return Promise.reject(
      Object.assign(new Error('Unique constraint failed on (stepId, attempt)'), { code: 'P2002' }),
    )
  }
  const row: ExecutionRow = { id: `exec-${attempt}`, stepId, attempt, status: 'running' }
  state.executions.push(row)
  state.ops.push(`execution-created:${attempt}`)
  return Promise.resolve(row)
}) as any
const mockExecutionUpdate = mock(() => Promise.resolve({})) as any

const mockStepEventCreate = mock((args: any) => {
  state.stepEvents.push({
    event: args.data.event,
    data: args.data.data ? JSON.parse(args.data.data) : null,
  })
  return Promise.resolve({ id: 'evt-1' })
}) as any
const mockActivityLogCreate = mock(() => Promise.resolve({ id: 'act-1' })) as any
const mockTaskUpdate = mock(() => Promise.resolve({})) as any
const mockArtifactCreateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockDeadLetterCreate = mock(() => Promise.resolve({ id: 'dl-1' })) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findUnique: mockTaskStepFindUnique,
      findFirst: mockTaskStepFindFirst,
      findMany: mockTaskStepFindMany,
      count: mockTaskStepCount,
      update: mockTaskStepUpdate,
      updateMany: mockTaskStepUpdateMany,
    },
    projectRuntime: { findUnique: mockRuntimeFindUnique },
    projectMode: { findFirst: mockProjectModeFindFirst },
    stepExecution: {
      count: mockExecutionCount,
      findFirst: mockExecutionFindFirst,
      findUnique: mockExecutionFindUnique,
      create: mockExecutionCreate,
      update: mockExecutionUpdate,
    },
    stepEvent: { create: mockStepEventCreate },
    activityLog: { create: mockActivityLogCreate },
    task: { update: mockTaskUpdate },
    stepArtifact: { createMany: mockArtifactCreateMany },
    deadLetterStep: { create: mockDeadLetterCreate },
  },
}))

const mockBroadcast = mock(() => Promise.resolve()) as any
mock.module('@/lib/server/realtime', () => ({ broadcastProjectEvent: mockBroadcast }))
mock.module('@/lib/server/project-event', () => ({ fireProjectEvent: mockBroadcast }))

// Import AFTER all mocks are in place
import { dispatchStep, setDispatchDeps, resetDispatchDeps } from '../dispatch'

// ---------------------------------------------------------------------------
// Fake adapter + seamed collaborators
// ---------------------------------------------------------------------------

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function until(cond: () => boolean, timeoutMs = 2000) {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await sleep(5)
  }
}

let adapterGate: { promise: Promise<void>; resolve: () => void } | null = null
const adapterDispatch = mock(async () => {
  state.ops.push('adapter-dispatch')
  if (adapterGate) await adapterGate.promise
  return { output: 'ok', tokensUsed: 7 }
}) as any
const fakeAdapter = { id: 'fake', name: 'Fake Adapter', available: true, dispatch: adapterDispatch }

let memoryDelayMs = 0
const fakeBuildWorkingMemory = mock(async () => {
  state.ops.push('memory-build')
  if (memoryDelayMs > 0) await sleep(memoryDelayMs)
  return ''
}) as any
const fakeBuildRelevantMemory = mock(async () => ({ text: '', hits: [] })) as any
const fakeResolveMcpTools = mock(async () => []) as any

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetState()
  adapterGate = null
  memoryDelayMs = 0
  for (const m of [
    mockTaskStepFindUnique,
    mockTaskStepUpdateMany,
    mockTaskStepUpdate,
    mockTaskStepCount,
    mockTaskStepFindFirst,
    mockTaskStepFindMany,
    mockRuntimeFindUnique,
    mockProjectModeFindFirst,
    mockExecutionCount,
    mockExecutionFindFirst,
    mockExecutionFindUnique,
    mockExecutionCreate,
    mockExecutionUpdate,
    mockStepEventCreate,
    mockActivityLogCreate,
    mockTaskUpdate,
    mockArtifactCreateMany,
    mockDeadLetterCreate,
    mockBroadcast,
    adapterDispatch,
    fakeBuildWorkingMemory,
    fakeBuildRelevantMemory,
    fakeResolveMcpTools,
  ]) {
    m.mockClear()
  }
  setDispatchDeps({
    getAdapter: () => fakeAdapter as any,
    buildWorkingMemory: fakeBuildWorkingMemory,
    buildRelevantMemoryWithHits: fakeBuildRelevantMemory,
    resolveMcpTools: fakeResolveMcpTools,
  })
})

// dispatchDeps lives on the shared module instance — restore the real
// implementations so later test files see production behaviour.
afterAll(() => {
  resetDispatchDeps()
})

// ===========================================================================
// The race tests (written first — B-1 TDD)
// ===========================================================================

describe('dispatchStep race hardening (B-1)', () => {
  test('takes the step lease before the expensive prelude (lease-first)', async () => {
    await dispatchStep('step-1')

    const leaseIdx = state.ops.indexOf('lease-taken')
    const memoryIdx = state.ops.indexOf('memory-build')
    expect(leaseIdx).toBeGreaterThanOrEqual(0)
    expect(memoryIdx).toBeGreaterThanOrEqual(0)
    // The lease must be held BEFORE memory build / prompt assembly starts.
    expect(leaseIdx).toBeLessThan(memoryIdx)
  })

  test('two concurrent dispatchStep calls on the same step: only one proceeds past the lease', async () => {
    memoryDelayMs = 10 // slow prelude — the window the second poll cycle exploits
    adapterGate = deferred() // park the winner inside the (slow) LLM call

    const p1 = dispatchStep('step-1')
    const p2 = dispatchStep('step-1')
    await sleep(60) // let both calls run their full pre-adapter path

    adapterGate.resolve()
    adapterGate = null
    await Promise.all([p1, p2])

    // Same process → same WORKER_ID → leaseStep lets both re-take the lease.
    // The in-process guard must reject the second entry outright.
    expect(state.ops.filter((op) => op === 'lease-taken').length).toBe(1)
    expect(state.stepEvents.filter((e) => e.event === 'leased').length).toBe(1)
    expect(adapterDispatch.mock.calls.length).toBe(1)
    expect(state.executions.length).toBe(1)
  })

  test('staggered attempt reads: the second dispatch must not reach the adapter (double LLM spend)', async () => {
    adapterGate = deferred()

    // First poll cycle: gets all the way into the adapter call and blocks there.
    const p1 = dispatchStep('step-1')
    await until(() => adapterDispatch.mock.calls.length >= 1)

    // Second poll cycle re-selects the step: its attempt read now happens
    // AFTER the first execution row exists, so it derives a different attempt
    // number and the unique constraint no longer protects us.
    const p2 = dispatchStep('step-1')
    await sleep(50) // give the second call time to run its full path

    adapterGate.resolve()
    adapterGate = null
    await Promise.all([p1, p2])

    expect(adapterDispatch.mock.calls.length).toBe(1)
    expect(state.executions.length).toBe(1)
    expect(state.stepEvents.filter((e) => e.event === 'started').length).toBe(1)
  })

  test('attempt allocation survives a unique-constraint conflict by taking the next number', async () => {
    // An execution row exists, but the attempt-number read is stale (racy
    // replica / concurrent insert). Allocation must retry past the P2002
    // instead of silently aborting the dispatch.
    state.executions.push({ id: 'exec-1', stepId: 'step-1', attempt: 1, status: 'succeeded' })
    state.staleAttemptReads = true

    await dispatchStep('step-1')

    expect(adapterDispatch.mock.calls.length).toBe(1)
    expect(state.executions.map((e) => e.attempt).sort()).toEqual([1, 2])
    const started = state.stepEvents.find((e) => e.event === 'started')
    expect(started?.data?.attempt).toBe(2)
  })

  test('releases the lease when the step loads without an agent (early exit)', async () => {
    state.agentMissing = true

    await dispatchStep('step-1')

    expect(adapterDispatch.mock.calls.length).toBe(0)
    expect(state.ops).toContain('lease-taken')
    expect(state.ops).toContain('lease-released')
    expect(state.leasedBy).toBeNull()
  })

  test('clears the lease when demoting a throttled step back to pending', async () => {
    state.activeAgentSteps = 5
    state.maxConcurrent = 1

    await dispatchStep('step-1')

    expect(adapterDispatch.mock.calls.length).toBe(0)
    expect(state.ops).toContain('lease-taken')
    expect(state.stepStatus).toBe('pending')
    // A pending step must not carry a lease — it would block re-dispatch.
    expect(state.leasedBy).toBeNull()
  })

  test('in-flight guard clears after completion: sequential dispatches still work', async () => {
    await dispatchStep('step-1')
    expect(state.stepStatus).toBe('done')

    state.stepStatus = 'active' // simulate re-activation (rewind / retry)
    await dispatchStep('step-1')

    expect(adapterDispatch.mock.calls.length).toBe(2)
    expect(state.executions.map((e) => e.attempt)).toEqual([1, 2])
  })
})
