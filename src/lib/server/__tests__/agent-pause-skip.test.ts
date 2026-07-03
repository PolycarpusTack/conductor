import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

// ===========================================================================
// D-4 — Agent pause toggle: dispatcher skip.
//
// Proves pollAndDispatch does NOT dispatch a step whose agent is paused
// (isActive=false). The pause toggle is only trustworthy if the dispatcher
// actually honours it — the "silently skipped" behaviour made intentional.
//
// The step-queue selection query filters `agent: { isActive: true, ... }`;
// this suite's fake db.taskStep.findMany faithfully applies that where clause
// (as a real DB would), so:
//   - if step-queue omits the isActive predicate, the paused step is returned
//     and dispatched → these tests fail (regression guard);
//   - with the predicate present, the paused step is never selected → its
//     lease is never taken and the adapter is never called for it.
//
// Harness conventions mirror budget-enforcement.test.ts: a stateful fake db
// via mock.module, the real dispatchStep driven through the dispatchDeps seam
// (fake adapter + no-op memory/MCP), resetDispatchDeps in afterAll. Budgets
// are neutralised by seeding no budgeted projects (project.findMany → []).
// ===========================================================================

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

type TaskRow = { id: string; projectId: string; title: string; description: string | null }

const state = {
  tasks: new Map<string, TaskRow>(),
  steps: new Map<string, StepRow>(),
  agents: new Map<string, Record<string, unknown>>(),
  executions: [] as Array<Record<string, unknown>>,
  execSeq: 0,
  // Captures the `where` of the main active-step selection so a test can
  // assert the isActive predicate is actually present in the query.
  activeSelectWheres: [] as Array<Record<string, any>>,
}

let counter = 0

/** Seeds one project + task + agent + one active step. isActive toggles pause. */
function seedAgentStep(opts: { isActive: boolean }) {
  counter += 1
  const projectId = `proj-${counter}`
  const taskId = `task-${counter}`
  const agentId = `agent-${counter}`
  const stepId = `step-${counter}`

  state.tasks.set(taskId, { id: taskId, projectId, title: `Task ${counter}`, description: null })
  state.agents.set(agentId, {
    id: agentId,
    projectId,
    runtimeId: 'rt-1',
    isActive: opts.isActive,
    maxConcurrent: 3,
    name: `Agent ${counter}`,
    role: null,
    capabilities: null,
    personality: null,
    systemPrompt: '',
    modeInstructions: null,
    mcpConnectionIds: null,
    runtimeModel: null,
    invocationMode: 'HTTP',
  })
  state.steps.set(stepId, {
    id: stepId,
    taskId,
    order: 1,
    status: 'active',
    mode: 'develop',
    instructions: null,
    prevSteps: null,
    nextSteps: null,
    isMergePoint: false,
    rejectionNote: null,
    attempts: 0,
    timeoutMs: 60000,
    maxRetries: 0,
    retryDelayMs: 0,
    fallbackAgentId: null,
    traceContext: null,
    autoContinue: true,
    agentId,
    leasedBy: null,
    leasedAt: null,
    output: null,
    error: null,
    startedAt: null,
    completedAt: null,
  })
  return { projectId, taskId, agentId, stepId }
}

function joinedStep(row: StepRow) {
  const task = state.tasks.get(row.taskId)!
  return {
    ...row,
    task: { ...task },
    agent: row.agentId ? state.agents.get(row.agentId) ?? null : null,
  }
}

/** Does this step satisfy the active-selection where clause the queue passes? */
function matchesActiveSelect(s: StepRow, where: Record<string, any>): boolean {
  if (where.status && s.status !== where.status) return false
  if (where.mode?.not !== undefined && s.mode === where.mode.not) return false

  const agent = s.agentId ? (state.agents.get(s.agentId) as Record<string, unknown> | undefined) : undefined
  const agentWhere = where.agent ?? {}
  if (agentWhere.runtimeId?.not === null && (agent?.runtimeId ?? null) === null) return false
  // The predicate under test: paused agents (isActive=false) must be excluded.
  if (agentWhere.isActive !== undefined && agent?.isActive !== agentWhere.isActive) return false

  // Lease branch: unleased (this suite never pre-leases).
  return s.leasedBy === null
}

function resetState() {
  state.tasks = new Map()
  state.steps = new Map()
  state.agents = new Map()
  state.executions = []
  state.execSeq = 0
  state.activeSelectWheres = []
  counter = 0
}

mock.module('@/lib/db', () => ({
  db: {
    daemon: { findMany: async () => [] },
    project: {
      // No budgeted projects → filterBudgetPausedProjects returns an empty set.
      findMany: async () => [],
    },
    taskStep: {
      findMany: async (args: any) => {
        const where = args?.where ?? {}
        if (where.id?.in) {
          return (where.id.in as string[])
            .map((id) => state.steps.get(id))
            .filter(Boolean)
            .map((r) => ({ output: (r as StepRow).output, status: (r as StepRow).status }))
        }
        if (where.status === 'active') {
          state.activeSelectWheres.push(where)
          return [...state.steps.values()]
            .filter((s) => matchesActiveSelect(s, where))
            .map((s) => ({
              id: s.id,
              agent: { invocationMode: state.agents.get(s.agentId!)?.invocationMode ?? 'HTTP' },
              task: { projectId: state.tasks.get(s.taskId)!.projectId },
            }))
        }
        if (where.status === 'pending') return [] // throttled selection — unused here
        if (where.taskId) {
          return [...state.steps.values()]
            .filter((s) => s.taskId === where.taskId)
            .sort((a, b) => a.order - b.order)
            .map(joinedStep)
        }
        return []
      },
      findUnique: async (args: any) => {
        const row = state.steps.get(args?.where?.id)
        if (!row) return null
        if (args?.select?.leasedBy) return { leasedBy: row.leasedBy }
        return joinedStep(row)
      },
      findFirst: async (args: any) => {
        const where = args?.where ?? {}
        const found = [...state.steps.values()].find(
          (s) => s.taskId === where.taskId && s.order === where.order,
        )
        return found ? { output: found.output } : null
      },
      count: async (args: any) => {
        const where = args?.where ?? {}
        return [...state.steps.values()].filter(
          (s) => s.agentId === where.agentId && s.status === 'active' && s.id !== where.id?.not,
        ).length
      },
      update: async (args: any) => {
        const row = state.steps.get(args?.where?.id)
        if (!row) throw new Error(`no step ${args?.where?.id}`)
        Object.assign(row, args?.data ?? {})
        return joinedStep(row)
      },
      updateMany: async (args: any) => {
        const where = args?.where ?? {}
        const data = args?.data ?? {}
        const row = where.id ? state.steps.get(where.id) : undefined
        if (!row) return { count: 0 }
        if (typeof data.leasedBy === 'string') {
          if (row.status !== 'active' || (row.leasedBy !== null && row.leasedBy !== data.leasedBy)) {
            return { count: 0 }
          }
          row.leasedBy = data.leasedBy
          row.leasedAt = data.leasedAt ?? new Date()
          return { count: 1 }
        }
        if (where.status && row.status !== where.status) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      },
    },
    task: { update: async () => ({}) },
    projectRuntime: { findUnique: async () => ({ id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null }) },
    projectMode: { findFirst: async () => null },
    stepExecution: {
      aggregate: async () => ({ _sum: { cost: null } }),
      findFirst: async (args: any) => {
        const rows = state.executions
          .filter((e) => e.stepId === args?.where?.stepId)
          .sort((a: any, b: any) => b.attempt - a.attempt)
        return rows[0] ?? null
      },
      findUnique: async (args: any) => state.executions.find((e: any) => e.id === args?.where?.id) ?? null,
      create: async (args: any) => {
        const { stepId, attempt } = args.data
        if (state.executions.some((e: any) => e.stepId === stepId && e.attempt === attempt)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        }
        state.execSeq += 1
        const row = { id: `exec-${state.execSeq}`, status: 'running', ...args.data, startedAt: new Date(), completedAt: null }
        state.executions.push(row)
        return row
      },
      update: async (args: any) => {
        const row = state.executions.find((e: any) => e.id === args?.where?.id)
        if (!row) throw new Error(`no execution ${args?.where?.id}`)
        Object.assign(row, args?.data ?? {})
        return row
      },
    },
    stepEvent: { create: async () => ({ id: 'evt-1' }) },
    activityLog: { findFirst: async () => null, create: async () => ({ id: 'act-1' }) },
    stepArtifact: { createMany: async (args: any) => ({ count: (args?.data ?? []).length }) },
    deadLetterStep: { create: async () => ({ id: 'dl-1' }) },
  },
}))

const mockBroadcast = mock(() => Promise.resolve()) as any
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcast,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))
mock.module('@/lib/server/project-event', () => ({ fireProjectEvent: mockBroadcast }))

// Import AFTER mocks
import { pollAndDispatch } from '../step-queue'
import { setDispatchDeps, resetDispatchDeps } from '../dispatch'

let adapterImpl: (params: Record<string, any>) => Promise<Record<string, unknown>>
const adapterDispatch = mock((params: Record<string, any>) => adapterImpl(params)) as any
const fakeAdapter = { id: 'fake', name: 'Fake Adapter', available: true, dispatch: adapterDispatch }

beforeEach(() => {
  resetState()
  adapterImpl = async () => ({ output: 'OUT', tokensUsed: 42 })
  adapterDispatch.mockClear()
  mockBroadcast.mockClear()
  setDispatchDeps({
    getAdapter: () => fakeAdapter as any,
    buildWorkingMemory: (async () => '') as any,
    buildRelevantMemoryWithHits: (async () => ({ text: '', hits: [] })) as any,
    resolveMcpTools: (async () => []) as any,
  })
})

afterAll(() => {
  resetDispatchDeps()
})

describe('D-4 dispatcher skips paused agents', () => {
  test('a paused agent (isActive=false) step is never selected, leased, or dispatched', async () => {
    const { stepId } = seedAgentStep({ isActive: false })

    const result = await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(result.polled).toBe(0)
    const step = state.steps.get(stepId)!
    expect(step.leasedBy).toBeNull()
    expect(step.status).toBe('active') // still active, just skipped
  })

  test('an active agent dispatches while a paused agent alongside it is skipped', async () => {
    const active = seedAgentStep({ isActive: true })
    const paused = seedAgentStep({ isActive: false })

    await pollAndDispatch()

    // Exactly one dispatch — the active agent's step ran to completion.
    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(active.stepId)!.status).toBe('done')

    // The paused agent's step was untouched.
    const pausedStep = state.steps.get(paused.stepId)!
    expect(pausedStep.leasedBy).toBeNull()
    expect(pausedStep.status).toBe('active')
  })

  test('resuming a paused agent lets its step dispatch on the next tick', async () => {
    const { agentId, stepId } = seedAgentStep({ isActive: false })

    await pollAndDispatch()
    expect(adapterDispatch).toHaveBeenCalledTimes(0)

    // Resume the agent, then poll again.
    ;(state.agents.get(agentId) as Record<string, unknown>).isActive = true
    await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(stepId)!.status).toBe('done')
  })

  test('the active-step selection query carries the isActive=true predicate', async () => {
    seedAgentStep({ isActive: true })

    await pollAndDispatch()

    expect(state.activeSelectWheres.length).toBeGreaterThan(0)
    // Regression guard: the queue must filter on the agent being active.
    expect(state.activeSelectWheres[0].agent).toMatchObject({ isActive: true })
  })
})
