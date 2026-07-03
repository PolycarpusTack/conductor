import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

// ===========================================================================
// B-6-T2 — dispatchStep behavioural suite.
//
// Covers the orchestration the other dispatch suites do NOT:
//   - prompt composition (task / mode / memory / previous output → adapter)
//   - adapter result storage (execution row, step output, artifacts, tokens)
//   - retry with backoff vs dead-letter vs fallback-agent escalation
//   - MCP tool resolution reaching the adapter, and its failure staying durable
//   - early-exit guard rails (no runtime, missing runtime row, bad adapter,
//     cross-project agent, stale status, attempt-allocation exhaustion)
//
// The concurrency races themselves live in dispatch-race.test.ts;
// advanceChain / rewind / close internals live in dispatch-logic.test.ts;
// backoff math and dead-letter row shape live in execution-hardening.test.ts.
//
// Same conventions as dispatch-race.test.ts: stateful fake db via mock.module
// (bun's module registry is shared across files — mocks are file-scoped fns
// reset in beforeEach), collaborators with real-module suites are substituted
// through the dispatchDeps seams, resetDispatchDeps in afterAll.
// ===========================================================================

// ---------------------------------------------------------------------------
// Stateful fake db — extends the race-suite fake to multiple steps, full
// execution-row lifecycle, artifacts, and dead letters.
// ---------------------------------------------------------------------------

type StepRow = {
  id: string
  taskId: string
  order: number
  status: string
  mode: string
  instructions: string | null
  prevSteps: string | null
  nextSteps: string | null
  isMergePoint: boolean
  rejectionNote: string | null
  attempts: number
  timeoutMs: number
  maxRetries: number
  retryDelayMs: number
  fallbackAgentId: string | null
  traceContext: string | null
  autoContinue: boolean
  agentId: string | null
  leasedBy: string | null
  leasedAt: Date | null
  output: string | null
  error: string | null
  startedAt: Date | null
  completedAt: Date | null
}

type AgentRow = {
  id: string
  projectId: string
  runtimeId: string | null
  maxConcurrent: number
  name: string
  role: string | null
  capabilities: string | null
  personality: string | null
  systemPrompt: string
  modeInstructions: string | null
  mcpConnectionIds: string | null
  runtimeModel: string | null
  invocationMode: string
  isActive: boolean
}

type ExecRow = {
  id: string
  stepId: string
  attempt: number
  status: string
  output: string | null
  error: string | null
  evidence: string | null
  tokensUsed: number | null
  cost: number | null
  durationMs: number | null
  startedAt: Date
  completedAt: Date | null
}

type ArtifactRow = {
  stepId: string
  executionId: string | null
  type: string
  label: string
  content: string | null
  url: string | null
  mimeType: string | null
}

const state = {
  task: { id: 'task-1', projectId: 'proj-1', title: 'Build calendar', description: 'A calendar app' as string | null },
  steps: new Map<string, StepRow>(),
  agents: new Map<string, AgentRow>(),
  runtime: null as Record<string, unknown> | null,
  projectMode: null as Record<string, unknown> | null,
  executions: [] as ExecRow[],
  artifacts: [] as ArtifactRow[],
  deadLetters: [] as Array<Record<string, unknown>>,
  taskUpdates: [] as Array<Record<string, unknown>>,
  stepEvents: [] as Array<{ stepId: string; event: string; data: Record<string, unknown> | null }>,
  broadcasts: [] as Array<{ event: string; payload: Record<string, unknown> }>,
  ops: [] as string[],
  // When set, the full step load (findUnique+include) reports this status even
  // though the lease row was 'active' — simulates state moving between the
  // lease and the read.
  loadStatusOverride: null as string | null,
  execCreateAlwaysConflict: false,
  execCreateGenericError: false,
  activeCountOverride: null as number | null,
  activityLogs: [] as Array<Record<string, unknown>>,
}

function makeStep(overrides: Partial<StepRow> = {}): StepRow {
  return {
    id: 'step-1',
    taskId: 'task-1',
    order: 1,
    status: 'active',
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
    leasedBy: null,
    leasedAt: null,
    output: null,
    error: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    projectId: 'proj-1',
    runtimeId: 'rt-1',
    maxConcurrent: 3,
    name: 'Agent One',
    role: 'builder',
    capabilities: null,
    personality: null,
    systemPrompt: '',
    modeInstructions: null,
    mcpConnectionIds: null,
    runtimeModel: null,
    invocationMode: 'HTTP',
    isActive: true,
    ...overrides,
  }
}

function resetState() {
  state.task = { id: 'task-1', projectId: 'proj-1', title: 'Build calendar', description: 'A calendar app' }
  state.steps = new Map([
    ['step-1', makeStep()],
    ['step-2', makeStep({ id: 'step-2', order: 2, status: 'pending' })],
  ])
  state.agents = new Map([
    ['agent-1', makeAgent()],
    ['agent-2', makeAgent({ id: 'agent-2', name: 'Agent Two', systemPrompt: 'FALLBACK {{agent.name}} takes over' })],
  ])
  state.runtime = { id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null }
  state.projectMode = null
  state.executions = []
  state.artifacts = []
  state.deadLetters = []
  state.taskUpdates = []
  state.stepEvents = []
  state.broadcasts = []
  state.ops = []
  state.loadStatusOverride = null
  state.execCreateAlwaysConflict = false
  state.execCreateGenericError = false
  state.activeCountOverride = null
  state.activityLogs = []
}

function joinedStep(row: StepRow, applyLoadOverride = false) {
  return {
    ...row,
    status: applyLoadOverride && state.loadStatusOverride ? state.loadStatusOverride : row.status,
    task: { ...state.task },
    agent: row.agentId ? state.agents.get(row.agentId) ?? null : null,
  }
}

function stepsOfTask(taskId: string) {
  return [...state.steps.values()]
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.order - b.order)
    .map((s) => joinedStep(s))
}

const mockTaskStepFindUnique = mock((args: any) => {
  const row = state.steps.get(args?.where?.id)
  if (!row) return Promise.resolve(null)
  if (args?.select?.leasedBy) return Promise.resolve({ leasedBy: row.leasedBy })
  return Promise.resolve(joinedStep(row, true))
}) as any

const mockTaskStepFindFirst = mock((args: any) => {
  const where = args?.where ?? {}
  const found = [...state.steps.values()].find(
    (s) => s.taskId === where.taskId && s.order === where.order,
  )
  return Promise.resolve(found ? { output: found.output } : null)
}) as any

const mockTaskStepFindMany = mock((args: any) => {
  const where = args?.where ?? {}
  if (where.id?.in) {
    const rows = (where.id.in as string[])
      .map((id) => state.steps.get(id))
      .filter(Boolean) as StepRow[]
    return Promise.resolve(rows.map((r) => ({ output: r.output })))
  }
  if (where.taskId) return Promise.resolve(stepsOfTask(where.taskId))
  return Promise.resolve([])
}) as any

const mockTaskStepCount = mock((args: any) => {
  if (state.activeCountOverride !== null) return Promise.resolve(state.activeCountOverride)
  const where = args?.where ?? {}
  const n = [...state.steps.values()].filter(
    (s) => s.agentId === where.agentId && s.status === 'active' && s.id !== where.id?.not,
  ).length
  return Promise.resolve(n)
}) as any

const mockTaskStepUpdate = mock((args: any) => {
  const row = state.steps.get(args?.where?.id)
  if (!row) return Promise.reject(new Error(`no step ${args?.where?.id}`))
  const data = args?.data ?? {}
  for (const [key, value] of Object.entries(data)) {
    ;(row as Record<string, unknown>)[key] = value
  }
  if (typeof data.status === 'string') state.ops.push(`step-status:${row.id}:${data.status}`)
  return Promise.resolve(joinedStep(row))
}) as any

const mockTaskStepUpdateMany = mock((args: any) => {
  const where = args?.where ?? {}
  const data = args?.data ?? {}
  const row = where.id ? state.steps.get(where.id) : undefined
  if (!row) return Promise.resolve({ count: 0 })

  // Lease acquisition (leaseStep): emulate Prisma where-semantics — status
  // must be active and the lease free, already ours, or expired (the OR
  // branch with `leasedAt: { lt }` carries the expiry cutoff).
  if (typeof data.leasedBy === 'string') {
    const expiryCutoff: Date | undefined = (where.OR as Array<Record<string, any>> | undefined)?.find(
      (b) => b.leasedAt?.lt,
    )?.leasedAt.lt
    const canLease =
      row.status === 'active' &&
      (row.leasedBy === null ||
        row.leasedBy === data.leasedBy ||
        (row.leasedAt !== null && expiryCutoff !== undefined && row.leasedAt < expiryCutoff))
    if (!canLease) return Promise.resolve({ count: 0 })
    row.leasedBy = data.leasedBy
    row.leasedAt = data.leasedAt ?? new Date()
    state.ops.push(`lease-taken:${row.id}`)
    return Promise.resolve({ count: 1 })
  }

  // Lease release (releaseLease)
  if ('leasedBy' in data && data.leasedBy === null && !('status' in data) && !('startedAt' in data)) {
    if (where.leasedBy && where.leasedBy !== row.leasedBy) return Promise.resolve({ count: 0 })
    row.leasedBy = null
    row.leasedAt = null
    state.ops.push(`lease-released:${row.id}`)
    return Promise.resolve({ count: 1 })
  }

  // startedAt stamp on first attempt: where { id, status: 'active' }
  if ('startedAt' in data) {
    if (where.status && row.status !== where.status) return Promise.resolve({ count: 0 })
    row.startedAt = data.startedAt
    return Promise.resolve({ count: 1 })
  }

  // Pending→active activation (activateStep)
  if (data.status === 'active' && where.status === 'pending') {
    if (row.status !== 'pending') return Promise.resolve({ count: 0 })
    row.status = 'active'
    state.ops.push(`step-activated:${row.id}`)
    return Promise.resolve({ count: 1 })
  }

  Object.assign(row, data)
  return Promise.resolve({ count: 1 })
}) as any

const mockTaskUpdate = mock((args: any) => {
  state.taskUpdates.push({ taskId: args?.where?.id, ...(args?.data ?? {}) })
  return Promise.resolve({})
}) as any

const mockRuntimeFindUnique = mock(() => Promise.resolve(state.runtime)) as any
const mockProjectModeFindFirst = mock(() => Promise.resolve(state.projectMode)) as any

const mockExecutionFindFirst = mock((args: any) => {
  const rows = state.executions
    .filter((e) => e.stepId === args?.where?.stepId)
    .sort((a, b) => b.attempt - a.attempt)
  return Promise.resolve(rows[0] ?? null)
}) as any

const mockExecutionFindUnique = mock((args: any) => {
  const row = state.executions.find((e) => e.id === args?.where?.id)
  return Promise.resolve(row ?? null)
}) as any

const mockExecutionCreate = mock((args: any) => {
  const { stepId, attempt } = args.data
  if (state.execCreateGenericError) {
    return Promise.reject(new Error('exec insert failed'))
  }
  if (state.execCreateAlwaysConflict || state.executions.some((e) => e.stepId === stepId && e.attempt === attempt)) {
    return Promise.reject(
      Object.assign(new Error('Unique constraint failed on (stepId, attempt)'), { code: 'P2002' }),
    )
  }
  const row: ExecRow = {
    id: `exec-${stepId}-${attempt}`,
    stepId,
    attempt,
    status: 'running',
    output: null,
    error: null,
    evidence: null,
    tokensUsed: null,
    cost: null,
    durationMs: null,
    startedAt: new Date(),
    completedAt: null,
  }
  state.executions.push(row)
  state.ops.push(`execution-created:${attempt}`)
  return Promise.resolve(row)
}) as any

const mockExecutionUpdate = mock((args: any) => {
  const row = state.executions.find((e) => e.id === args?.where?.id)
  if (!row) return Promise.reject(new Error(`no execution ${args?.where?.id}`))
  Object.assign(row, args?.data ?? {})
  return Promise.resolve(row)
}) as any

const mockStepEventCreate = mock((args: any) => {
  state.stepEvents.push({
    stepId: args.data.stepId,
    event: args.data.event,
    data: args.data.data ? JSON.parse(args.data.data) : null,
  })
  return Promise.resolve({ id: 'evt-1' })
}) as any

const mockActivityLogCreate = mock((args: any) => {
  state.activityLogs.push(args?.data ?? {})
  return Promise.resolve({ id: 'act-1' })
}) as any

const mockArtifactCreateMany = mock((args: any) => {
  for (const row of args?.data ?? []) state.artifacts.push(row)
  return Promise.resolve({ count: (args?.data ?? []).length })
}) as any

const mockDeadLetterCreate = mock((args: any) => {
  state.deadLetters.push(args.data)
  return Promise.resolve({ id: 'dl-1' })
}) as any

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

const mockBroadcast = mock((_projectId: string, event: string, payload: Record<string, unknown>) => {
  state.broadcasts.push({ event, payload })
  return Promise.resolve()
}) as any
mock.module('@/lib/server/realtime', () => ({ broadcastProjectEvent: mockBroadcast }))
mock.module('@/lib/server/project-event', () => ({ fireProjectEvent: mockBroadcast }))

// Import AFTER all mocks are in place
import { dispatchStep, setDispatchDeps, resetDispatchDeps } from '../dispatch'

// ---------------------------------------------------------------------------
// Fake adapter + seamed collaborators
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type AdapterParams = Record<string, any>

let adapterImpl: (params: AdapterParams) => Promise<Record<string, unknown>>
const adapterDispatch = mock((params: AdapterParams) => adapterImpl(params)) as any
const fakeAdapter = { id: 'fake', name: 'Fake Adapter', available: true, dispatch: adapterDispatch }

let workingMemoryValue = ''
let relevantMemoryValue: { text: string; hits: unknown[] } = { text: '', hits: [] }
const fakeBuildWorkingMemory = mock(async () => workingMemoryValue) as any
const fakeBuildRelevantMemory = mock(async () => relevantMemoryValue) as any

let mcpToolsImpl: (...args: unknown[]) => Promise<unknown[]>
const fakeResolveMcpTools = mock((...args: unknown[]) => mcpToolsImpl(...args)) as any

function events(name: string) {
  return state.stepEvents.filter((e) => e.event === name)
}

function broadcastsOf(name: string) {
  return state.broadcasts.filter((b) => b.event === name)
}

function adapterParams(call = 0): AdapterParams {
  return adapterDispatch.mock.calls[call][0]
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetState()
  adapterImpl = async () => ({ output: 'ADAPTER_OUTPUT', tokensUsed: 42 })
  workingMemoryValue = ''
  relevantMemoryValue = { text: '', hits: [] }
  mcpToolsImpl = async () => []
  for (const m of [
    mockTaskStepFindUnique,
    mockTaskStepFindFirst,
    mockTaskStepFindMany,
    mockTaskStepCount,
    mockTaskStepUpdate,
    mockTaskStepUpdateMany,
    mockTaskUpdate,
    mockRuntimeFindUnique,
    mockProjectModeFindFirst,
    mockExecutionFindFirst,
    mockExecutionFindUnique,
    mockExecutionCreate,
    mockExecutionUpdate,
    mockStepEventCreate,
    mockActivityLogCreate,
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
// 1. Happy path — prompt composition → adapter → storage → advance
// ===========================================================================

describe('dispatchStep happy path', () => {
  test('composes the system prompt from task, mode, memory, and agent context and delivers it to the adapter', async () => {
    const agent = state.agents.get('agent-1')!
    agent.systemPrompt =
      'AGENT {{agent.name}} ({{agent.capabilities}}) | TASK {{task.title}} | MODE {{mode.instructions}} | RECENT {{memory.recent}} | RELEVANT {{memory.relevant}}'
    agent.capabilities = '["typescript","react"]'
    agent.runtimeModel = 'claude-test-1'
    state.projectMode = {
      id: 'pm-1',
      projectId: 'proj-1',
      name: 'develop',
      label: 'Develop',
      instructions: 'Follow TDD strictly',
      outputFormat: 'markdown',
      toolAllowlist: null,
    }
    workingMemoryValue = 'WM_RECENT_TOKEN'
    relevantMemoryValue = { text: 'RM_RELEVANT_TOKEN', hits: [{ memoryId: 'm1' }] }

    await dispatchStep('step-1')

    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    const params = adapterParams()
    // Template resolution: every context layer must land in the prompt.
    expect(params.systemPrompt).toContain('AGENT Agent One (typescript, react)')
    expect(params.systemPrompt).toContain('TASK Build calendar')
    expect(params.systemPrompt).toContain('Follow TDD strictly')
    // Mode output-format policy rides the mode-instruction layer.
    expect(params.systemPrompt).toContain('Respond in markdown format.')
    expect(params.systemPrompt).toContain('RECENT WM_RECENT_TOKEN')
    expect(params.systemPrompt).toContain('RELEVANT RM_RELEVANT_TOKEN')
    // Task context travels separately from the system prompt.
    expect(params.taskContext).toContain('Task: Build calendar')
    expect(params.taskContext).toContain('Description: A calendar app')
    expect(params.taskContext).toContain('Step Instructions: do the thing')
    expect(params.mode).toBe('develop')
    expect(params.model).toBe('claude-test-1')

    // Relevant-memory retrieval is driven by the task/step text.
    const memArgs = fakeBuildRelevantMemory.mock.calls[0][0]
    expect(memArgs.agentId).toBe('agent-1')
    expect(memArgs.projectId).toBe('proj-1')
    expect(memArgs.query).toContain('Build calendar')
    expect(memArgs.query).toContain('do the thing')
    expect(memArgs.limit).toBe(5)
  })

  test('agent-level mode instructions override the project mode instructions', async () => {
    const agent = state.agents.get('agent-1')!
    agent.systemPrompt = 'MODE:{{mode.instructions}}'
    agent.modeInstructions = JSON.stringify({ develop: 'AGENT_MODE_OVERRIDE' })
    state.projectMode = {
      id: 'pm-1',
      name: 'develop',
      label: 'Develop',
      instructions: 'PROJECT_MODE_INSTRUCTIONS',
      outputFormat: null,
      toolAllowlist: null,
    }

    await dispatchStep('step-1')

    expect(adapterParams().systemPrompt).toContain('AGENT_MODE_OVERRIDE')
    expect(adapterParams().systemPrompt).not.toContain('PROJECT_MODE_INSTRUCTIONS')
  })

  test('stores the adapter result on the execution and step, clears the lease, and advances the chain', async () => {
    await dispatchStep('step-1')

    // Execution row: succeeded with output + token usage.
    expect(state.executions).toHaveLength(1)
    const exec = state.executions[0]
    expect(exec.attempt).toBe(1)
    expect(exec.status).toBe('succeeded')
    expect(exec.output).toBe('ADAPTER_OUTPUT')
    expect(exec.tokensUsed).toBe(42)
    expect(exec.completedAt).toBeInstanceOf(Date)

    // Step row: done, output persisted, attempts recorded, lease cleared.
    const step = state.steps.get('step-1')!
    expect(step.status).toBe('done')
    expect(step.output).toBe('ADAPTER_OUTPUT')
    expect(step.attempts).toBe(1)
    expect(step.completedAt).toBeInstanceOf(Date)
    expect(step.leasedBy).toBeNull()
    expect(step.leasedAt).toBeNull()
    // First attempt stamps startedAt.
    expect(step.startedAt).toBeInstanceOf(Date)

    // Durable audit trail.
    const succeeded = events('succeeded')
    expect(succeeded).toHaveLength(1)
    expect(succeeded[0].data?.tokensUsed).toBe(42)

    // advanceChain effect: the next linear step is activated and the task
    // stays IN_PROGRESS.
    expect(state.steps.get('step-2')!.status).toBe('active')
    expect(state.taskUpdates.at(-1)?.status).toBe('IN_PROGRESS')
    expect(broadcastsOf('step-completed')).toHaveLength(1)
    expect(broadcastsOf('step-completed')[0].payload.output).toBe('ADAPTER_OUTPUT')
    expect(broadcastsOf('chain-advanced')[0]?.payload.toStepId).toBe('step-2')

    // No artifacts returned → none persisted.
    expect(state.artifacts).toHaveLength(0)
  })

  test('completing the last step in the chain marks the task DONE', async () => {
    state.steps.delete('step-2')

    await dispatchStep('step-1')

    expect(state.steps.get('step-1')!.status).toBe('done')
    const done = state.taskUpdates.find((u) => u.status === 'DONE')
    expect(done).toBeDefined()
    expect(done?.completedAt).toBeInstanceOf(Date)
    expect(broadcastsOf('chain-completed')).toHaveLength(1)
  })

  test('records retrieval evidence (memory hits) on the execution', async () => {
    relevantMemoryValue = { text: 'stuff', hits: [{ memoryId: 'm1', score: 0.9 }] }
    workingMemoryValue = 'recent stuff'

    await dispatchStep('step-1')

    const evidence = JSON.parse(state.executions[0].evidence ?? 'null')
    expect(evidence).toEqual({
      memoryHits: [{ memoryId: 'm1', score: 0.9 }],
      workingMemory: true,
    })
  })
})

// ===========================================================================
// 2. Previous-output / rewind context composition
// ===========================================================================

describe('dispatchStep previous-output composition', () => {
  test('passes the linear predecessor output to the adapter', async () => {
    state.steps.get('step-1')!.status = 'done'
    state.steps.get('step-1')!.output = 'PREV_OUT_LINEAR'
    state.steps.get('step-2')!.status = 'active'
    state.agents.get('agent-1')!.systemPrompt = 'PREV:{{step.previousOutput}}'

    await dispatchStep('step-2')

    expect(adapterParams().previousOutput).toBe('PREV_OUT_LINEAR')
    expect(adapterParams().systemPrompt).toContain('PREV:PREV_OUT_LINEAR')
  })

  test('merges multi-parent DAG predecessor outputs', async () => {
    state.steps.get('step-1')!.status = 'done'
    state.steps.get('step-1')!.output = 'BRANCH_A'
    state.steps.get('step-2')!.status = 'done'
    state.steps.get('step-2')!.output = 'BRANCH_B'
    state.steps.set(
      'step-3',
      makeStep({
        id: 'step-3',
        order: 3,
        status: 'active',
        prevSteps: JSON.stringify(['step-1', 'step-2']),
        nextSteps: '[]',
        isMergePoint: true,
      }),
    )

    await dispatchStep('step-3')

    expect(adapterParams().previousOutput).toBe('BRANCH_A\n\n---\n\nBRANCH_B')
  })

  test('passes a single DAG predecessor output without merging', async () => {
    state.steps.get('step-1')!.status = 'done'
    state.steps.get('step-1')!.output = 'ONLY_PARENT'
    state.steps.set(
      'step-3',
      makeStep({
        id: 'step-3',
        order: 3,
        status: 'active',
        prevSteps: JSON.stringify(['step-1']),
        nextSteps: '[]',
      }),
    )
    state.steps.get('step-2')!.status = 'done'

    await dispatchStep('step-3')

    expect(adapterParams().previousOutput).toBe('ONLY_PARENT')
  })

  test('includes human rejection feedback in the task context after a rewind', async () => {
    const step = state.steps.get('step-1')!
    step.rejectionNote = 'Wrong colors, use the brand palette'
    step.attempts = 1

    await dispatchStep('step-1')

    expect(adapterParams().taskContext).toContain('HUMAN FEEDBACK (from previous attempt #1):')
    expect(adapterParams().taskContext).toContain('Wrong colors, use the brand palette')
  })
})

// ===========================================================================
// 2b. Chain-advance interplay observable through dispatchStep
// ===========================================================================

describe('dispatchStep chain-advance interplay', () => {
  test('a DAG step with a matching conditional edge activates only that branch', async () => {
    const step1 = state.steps.get('step-1')!
    step1.nextSteps = JSON.stringify([
      { targetStepId: 'step-2', condition: { field: 'output', operator: 'contains', value: 'ADAPTER' } },
      { targetStepId: 'step-3' }, // unconditional default path
    ])
    state.steps.get('step-2')!.prevSteps = JSON.stringify(['step-1'])
    state.steps.set(
      'step-3',
      makeStep({ id: 'step-3', order: 3, status: 'pending', prevSteps: JSON.stringify(['step-1']) }),
    )

    await dispatchStep('step-1')

    // Adapter output 'ADAPTER_OUTPUT' matches the condition → conditional
    // branch wins, the default branch stays parked.
    expect(state.steps.get('step-2')!.status).toBe('active')
    expect(state.steps.get('step-3')!.status).toBe('pending')
    expect(state.taskUpdates.at(-1)?.status).toBe('IN_PROGRESS')
  })

  test('autoContinue=false parks the task WAITING instead of activating the next step', async () => {
    state.steps.get('step-1')!.autoContinue = false

    await dispatchStep('step-1')

    expect(state.steps.get('step-1')!.status).toBe('done')
    expect(state.steps.get('step-2')!.status).toBe('pending')
    expect(state.taskUpdates.at(-1)?.status).toBe('WAITING')
    expect(broadcastsOf('step-activated')).toHaveLength(0)
  })
})

// ===========================================================================
// 3. Retry & backoff
// ===========================================================================

describe('dispatchStep retry & backoff', () => {
  test('a retryable adapter error fails the execution and schedules a backoff retry — no dead letter', async () => {
    adapterImpl = async () => {
      throw new Error('LLM boom')
    }
    const step = state.steps.get('step-1')!
    step.maxRetries = 2
    step.retryDelayMs = 5000
    const before = Date.now()

    await dispatchStep('step-1')

    // Attempt recorded as failed with the error.
    expect(state.executions).toHaveLength(1)
    expect(state.executions[0].status).toBe('failed')
    expect(state.executions[0].error).toBe('LLM boom')

    // Step stays active and schedulable: lease holder cleared, leasedAt used
    // as the not-before time with exponential backoff + jitter
    // (attempt 1, base 5000 → [5000, 10000)).
    expect(step.status).toBe('active')
    expect(step.attempts).toBe(1)
    expect(step.leasedBy).toBeNull()
    expect(step.leasedAt).toBeInstanceOf(Date)
    const delay = (step.leasedAt as Date).getTime() - before
    expect(delay).toBeGreaterThanOrEqual(5000)
    expect(delay).toBeLessThan(11000)

    const retryEvent = events('retry_scheduled')
    expect(retryEvent).toHaveLength(1)
    expect(retryEvent[0].data?.attempt).toBe(1)
    expect(retryEvent[0].data?.error).toBe('LLM boom')
    expect(retryEvent[0].data?.delayMs as number).toBeGreaterThanOrEqual(5000)

    expect(broadcastsOf('step-retrying')).toHaveLength(1)
    // NOT dead-lettered and NOT failed before maxAttempts.
    expect(state.deadLetters).toHaveLength(0)
    expect(broadcastsOf('step-failed')).toHaveLength(0)
    expect(state.taskUpdates.filter((u) => u.status === 'WAITING')).toHaveLength(0)
  })

  test('a step timeout is recorded as timed_out and retried immediately when retryDelayMs is 0', async () => {
    adapterImpl = async () => {
      await sleep(300)
      return { output: 'too late' }
    }
    const step = state.steps.get('step-1')!
    step.timeoutMs = 20
    step.retryDelayMs = 0

    await dispatchStep('step-1')

    expect(state.executions[0].status).toBe('timed_out')
    const failedEvent = events('failed')
    expect(failedEvent).toHaveLength(1)
    expect(failedEvent[0].data?.timeout).toBe(true)

    // Zero delay → immediately re-pickable: no not-before timestamp.
    expect(step.status).toBe('active')
    expect(step.leasedBy).toBeNull()
    expect(step.leasedAt).toBeNull()
    expect(events('retry_scheduled')[0].data?.delayMs).toBe(0)
  })
})

// ===========================================================================
// 4. Exhaustion → dead letter
// ===========================================================================

describe('dispatchStep retry exhaustion', () => {
  test('exhausted attempts dead-letter the step, fail it, and resolve the task status', async () => {
    adapterImpl = async () => {
      throw new Error('LLM boom')
    }
    const step = state.steps.get('step-1')!
    step.maxRetries = 1
    // One failed attempt already on record → this dispatch is attempt 2 of 2.
    state.executions.push({
      id: 'exec-step-1-1',
      stepId: 'step-1',
      attempt: 1,
      status: 'failed',
      output: null,
      error: 'LLM boom',
      evidence: null,
      tokensUsed: null,
      cost: null,
      durationMs: null,
      startedAt: new Date(),
      completedAt: new Date(),
    })

    await dispatchStep('step-1')

    // Dead-letter snapshot with the final attempt count and last error.
    expect(state.deadLetters).toHaveLength(1)
    expect(state.deadLetters[0].originalStepId).toBe('step-1')
    expect(state.deadLetters[0].attempts).toBe(2)
    expect(state.deadLetters[0].lastError).toBe('LLM boom')

    // Step terminally failed, lease cleared.
    expect(step.status).toBe('failed')
    expect(step.error).toBe('Failed after 2 attempts. Last error: LLM boom')
    expect(step.leasedBy).toBeNull()

    const failedBroadcast = broadcastsOf('step-failed')
    expect(failedBroadcast).toHaveLength(1)
    expect(failedBroadcast[0].payload.exhaustedRetries).toBe(true)

    // resolveTaskStatus: step-2 is still pending (no active agent step) → WAITING.
    expect(state.taskUpdates.at(-1)?.status).toBe('WAITING')
    expect(events('retry_scheduled')).toHaveLength(0)
  })
})

// ===========================================================================
// 5. Fallback-agent escalation
// ===========================================================================

describe('dispatchStep fallback-agent escalation', () => {
  test('exhausted primary hands the step to the fallback agent instead of dead-lettering', async () => {
    adapterImpl = async () => {
      throw new Error('primary broken')
    }
    const step = state.steps.get('step-1')!
    step.maxRetries = 0 // first failure exhausts the primary
    step.fallbackAgentId = 'agent-2'

    await dispatchStep('step-1')

    // Reset for a fresh attempt cycle under the fallback agent.
    expect(step.agentId).toBe('agent-2')
    expect(step.status).toBe('active')
    expect(step.attempts).toBe(0)
    expect(step.error).toBeNull()
    expect(step.leasedBy).toBeNull()
    expect(step.leasedAt).toBeNull()

    expect(state.deadLetters).toHaveLength(0)
    const fallback = broadcastsOf('step-fallback')
    expect(fallback).toHaveLength(1)
    expect(fallback[0].payload.fromAgentId).toBe('agent-1')
    expect(fallback[0].payload.toAgentId).toBe('agent-2')
  })

  test('the fallback agent actually receives the next dispatch', async () => {
    let calls = 0
    adapterImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error('primary broken')
      return { output: 'RESCUED', tokensUsed: 5 }
    }
    const step = state.steps.get('step-1')!
    step.maxRetries = 0
    step.fallbackAgentId = 'agent-2'

    await dispatchStep('step-1') // primary fails → escalates
    await dispatchStep('step-1') // queue re-picks the step, now on agent-2

    expect(adapterDispatch).toHaveBeenCalledTimes(2)
    // The second dispatch composes the FALLBACK agent's prompt.
    expect(adapterParams(1).systemPrompt).toContain('FALLBACK Agent Two takes over')
    // Attempt numbering continues from the execution history.
    expect(state.executions.map((e) => e.attempt)).toEqual([1, 2])
    expect(state.executions[1].status).toBe('succeeded')
    expect(step.status).toBe('done')
    expect(step.output).toBe('RESCUED')
  })

  test('a fallback pointing at the failing agent itself dead-letters instead of looping', async () => {
    adapterImpl = async () => {
      throw new Error('still broken')
    }
    const step = state.steps.get('step-1')!
    step.maxRetries = 0
    step.fallbackAgentId = 'agent-1' // same agent — no escape hatch

    await dispatchStep('step-1')

    expect(state.deadLetters).toHaveLength(1)
    expect(step.status).toBe('failed')
    expect(broadcastsOf('step-fallback')).toHaveLength(0)
  })
})

// ===========================================================================
// 6. MCP tools
// ===========================================================================

describe('dispatchStep MCP tools', () => {
  test('resolved MCP tools, connection ids, and executionId reach the adapter', async () => {
    const agent = state.agents.get('agent-1')!
    agent.mcpConnectionIds = JSON.stringify(['conn-1', 'conn-2'])
    state.projectMode = {
      id: 'pm-1',
      name: 'develop',
      label: 'Develop',
      instructions: '',
      outputFormat: null,
      toolAllowlist: JSON.stringify(['tool_a']),
    }
    const tool = { name: 'tool_a', description: 'does a', input_schema: {} }
    mcpToolsImpl = async () => [tool]

    await dispatchStep('step-1')

    // The resolver receives connections, the step mode, and the mode's allowlist.
    expect(fakeResolveMcpTools).toHaveBeenCalledTimes(1)
    expect(fakeResolveMcpTools.mock.calls[0]).toEqual([['conn-1', 'conn-2'], 'develop', ['tool_a']])

    const params = adapterParams()
    expect(params.tools).toEqual([tool])
    expect(params.mcpConnectionIds).toEqual(['conn-1', 'conn-2'])
    // Tool-call tracing needs the execution id at dispatch time.
    expect(params.executionId).toBe(state.executions[0].id)
  })

  test('no connections → adapter is called without tools', async () => {
    await dispatchStep('step-1')
    expect(adapterParams().tools).toBeUndefined()
    expect(adapterParams().mcpConnectionIds).toBeUndefined()
  })

  test('a resolveMcpTools failure releases the lease and leaves the step retryable (poller-safe)', async () => {
    mcpToolsImpl = async () => {
      throw new Error('MCP registry down')
    }

    // The rejection surfaces to the caller (pollAndDispatch wraps dispatches
    // in Promise.allSettled, so it never crashes the poller)...
    await expect(dispatchStep('step-1')).rejects.toThrow('MCP registry down')

    // ...but the failure is durable: no adapter call, no execution attempt
    // burned, lease given back so the next poll can retry.
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(state.executions).toHaveLength(0)
    const step = state.steps.get('step-1')!
    expect(step.status).toBe('active')
    expect(step.leasedBy).toBeNull()
    expect(state.ops).toContain('lease-released:step-1')

    // Recovery: once MCP resolution works again the same step dispatches
    // (in-flight guard and lease both cleared).
    mcpToolsImpl = async () => []
    await dispatchStep('step-1')
    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(step.status).toBe('done')
  })
})

// ===========================================================================
// 7. Guard rails / early exits
// ===========================================================================

describe('dispatchStep guard rails', () => {
  test('an agent without a runtime (human-operated) never reaches the adapter and keeps the step alive', async () => {
    state.agents.get('agent-1')!.runtimeId = null

    await dispatchStep('step-1')

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(state.executions).toHaveLength(0)
    const step = state.steps.get('step-1')!
    // Not failed — a human/no-runtime step simply is not dispatchable here.
    expect(step.status).toBe('active')
    expect(step.leasedBy).toBeNull()
    expect(state.ops).toContain('lease-released:step-1')
    expect(broadcastsOf('step-failed')).toHaveLength(0)
  })

  test('a step whose status moved between lease and load gives the lease back without side effects', async () => {
    state.loadStatusOverride = 'done' // simulate concurrent completion

    await dispatchStep('step-1')

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(state.ops).toContain('lease-taken:step-1')
    expect(state.ops).toContain('lease-released:step-1')
    expect(state.executions).toHaveLength(0)
    expect(state.taskUpdates).toHaveLength(0)
  })

  test('a missing runtime row fails the step with a clear error', async () => {
    state.runtime = null

    await dispatchStep('step-1')

    const step = state.steps.get('step-1')!
    expect(step.status).toBe('failed')
    expect(step.error).toBe('Runtime not found')
    expect(step.leasedBy).toBeNull()
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(broadcastsOf('step-failed')).toHaveLength(1)
    // resolveTaskStatus ran: step-2 pending only → WAITING.
    expect(state.taskUpdates.at(-1)?.status).toBe('WAITING')
  })

  test('an unavailable adapter fails the step', async () => {
    setDispatchDeps({ getAdapter: () => ({ ...fakeAdapter, available: false }) as any })

    await dispatchStep('step-1')

    const step = state.steps.get('step-1')!
    expect(step.status).toBe('failed')
    expect(step.error).toBe('Adapter "fake" not available')
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
  })

  test('an agent from another project fails the step', async () => {
    state.agents.get('agent-1')!.projectId = 'other-project'

    await dispatchStep('step-1')

    const step = state.steps.get('step-1')!
    expect(step.status).toBe('failed')
    expect(step.error).toBe('Agent does not belong to this project')
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
  })

  test('reclaiming an expired lease records the eviction and still dispatches', async () => {
    const step = state.steps.get('step-1')!
    step.leasedBy = 'worker-dead'
    step.leasedAt = new Date(Date.now() - 60 * 60 * 1000) // long past the lease timeout

    await dispatchStep('step-1')

    // The steal is audited both as an activity-log row and on the leased event.
    const reclaim = state.activityLogs.find((a) => a.action === 'lease_reclaimed')
    expect(reclaim).toBeDefined()
    expect(JSON.parse(reclaim!.details as string).previousLeaseholder).toBe('worker-dead')
    expect(events('leased')[0].data?.evictedFrom).toBe('worker-dead')

    // And the dispatch itself proceeds normally.
    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(step.status).toBe('done')
  })

  test('a non-conflict error during attempt allocation surfaces to the caller without an adapter call', async () => {
    state.execCreateGenericError = true // e.g. db connection dropped

    await expect(dispatchStep('step-1')).rejects.toThrow('exec insert failed')

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(state.executions).toHaveLength(0)
  })

  test('attempt-allocation exhaustion releases the lease without dispatching', async () => {
    state.execCreateAlwaysConflict = true // every insert hits P2002

    await dispatchStep('step-1')

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    const step = state.steps.get('step-1')!
    expect(step.status).toBe('active')
    expect(step.leasedBy).toBeNull()
    expect(state.ops).toContain('lease-released:step-1')
  })
})

// ===========================================================================
// 8. Artifact & token persistence
// ===========================================================================

describe('dispatchStep artifact persistence', () => {
  test('adapter artifacts are persisted with execution linkage and nullable fields normalized', async () => {
    adapterImpl = async () => ({
      output: 'with artifacts',
      tokensUsed: 123,
      artifacts: [
        { type: 'code', label: 'patch', content: 'diff --git a b' },
        { type: 'url', label: 'screenshot', url: 'https://example.test/s.png', mimeType: 'image/png' },
      ],
    })

    await dispatchStep('step-1')

    expect(state.artifacts).toHaveLength(2)
    const execId = state.executions[0].id
    expect(state.artifacts[0]).toEqual({
      stepId: 'step-1',
      executionId: execId,
      type: 'code',
      label: 'patch',
      content: 'diff --git a b',
      url: null,
      mimeType: null,
    })
    expect(state.artifacts[1]).toEqual({
      stepId: 'step-1',
      executionId: execId,
      type: 'url',
      label: 'screenshot',
      content: null,
      url: 'https://example.test/s.png',
      mimeType: 'image/png',
    })

    // Token usage persisted on the execution and broadcast with completion.
    expect(state.executions[0].tokensUsed).toBe(123)
    expect(broadcastsOf('step-completed')[0].payload.tokensUsed).toBe(123)
  })
})
