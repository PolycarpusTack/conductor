import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

// ===========================================================================
// B-7 — Spend budgets + TD-018 cost wiring.
//
// Covers:
//   - TD-018: adapter-reported cost lands on the StepExecution row; when the
//     adapter reports tokens but no cost, dispatch records the model estimate
//     (cost-estimator) so budgets have a recorded spend to aggregate.
//   - pollAndDispatch skips a project whose month-to-date recorded cost has
//     reached Project.budgetUsd, with exactly ONE budget_exceeded activity
//     per pause episode + a project broadcast; under-budget and no-budget
//     projects dispatch unchanged (nullable column IS the feature flag).
//   - raising the budget resumes dispatch next tick and writes budget_lifted.
//   - month boundary: cost recorded last month (UTC) does not count.
//   - PUT /api/projects/[id] validation: budgetUsd rejects negatives.
//
// Same conventions as dispatch-step.test.ts: stateful fake db via
// mock.module ('@/lib/db' + realtime + project-event — the latter because
// earlier suites leave their own project-event mock in bun's shared module
// registry), adapter/memory/MCP substituted through the dispatchDeps seams,
// resetDispatchDeps in afterAll.
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

type ExecRow = {
  id: string
  stepId: string
  projectId: string // test-store denormalization for the aggregate mock
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

const state = {
  projects: [] as Array<{ id: string; budgetUsd: number | null }>,
  tasks: new Map<string, TaskRow>(),
  steps: new Map<string, StepRow>(),
  agents: new Map<string, Record<string, unknown>>(),
  runtime: { id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null } as Record<string, unknown> | null,
  executions: [] as ExecRow[],
  activityLogs: [] as Array<Record<string, unknown> & { createdAt: Date }>,
  broadcasts: [] as Array<{ projectId: string; event: string; payload: Record<string, unknown> }>,
  aggregateCalls: [] as Array<Record<string, unknown>>,
  execSeq: 0,
}

let projectCounter = 0

/** Seeds one project with one task, one agent, and one active step. */
function seedProject(opts: { budgetUsd?: number | null; model?: string | null } = {}) {
  projectCounter += 1
  const projectId = `proj-${projectCounter}`
  const taskId = `task-${projectCounter}`
  const agentId = `agent-${projectCounter}`
  const stepId = `step-${projectCounter}`

  state.projects.push({ id: projectId, budgetUsd: opts.budgetUsd ?? null })
  state.tasks.set(taskId, { id: taskId, projectId, title: `Task ${projectCounter}`, description: null })
  state.agents.set(agentId, {
    id: agentId,
    projectId,
    runtimeId: 'rt-1',
    maxConcurrent: 3,
    name: `Agent ${projectCounter}`,
    role: null,
    capabilities: null,
    personality: null,
    systemPrompt: '',
    modeInstructions: null,
    mcpConnectionIds: null,
    runtimeModel: opts.model ?? null,
    invocationMode: 'HTTP',
    isActive: true,
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

/** Records prior spend for a project (defaults to "now" = this UTC month). */
function recordSpend(projectId: string, cost: number, startedAt = new Date()) {
  state.execSeq += 1
  state.executions.push({
    id: `seed-exec-${state.execSeq}`,
    stepId: `seed-step-${state.execSeq}`,
    projectId,
    attempt: 1,
    status: 'succeeded',
    output: null,
    error: null,
    evidence: null,
    tokensUsed: null,
    cost,
    durationMs: null,
    startedAt,
    completedAt: startedAt,
  })
}

function joinedStep(row: StepRow) {
  const task = state.tasks.get(row.taskId)!
  return {
    ...row,
    task: { ...task },
    agent: row.agentId ? state.agents.get(row.agentId) ?? null : null,
  }
}

function resetState() {
  state.projects = []
  state.tasks = new Map()
  state.steps = new Map()
  state.agents = new Map()
  state.runtime = { id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null }
  state.executions = []
  state.activityLogs = []
  state.broadcasts = []
  state.aggregateCalls = []
  state.execSeq = 0
  projectCounter = 0
}

mock.module('@/lib/db', () => ({
  db: {
    // pollAndDispatch's stale-daemon sweep (throttled — may or may not fire).
    daemon: { findMany: async () => [] },
    project: {
      findMany: async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? []
        return state.projects
          .filter((p) => ids.includes(p.id) && p.budgetUsd !== null)
          .map((p) => ({ id: p.id, budgetUsd: p.budgetUsd }))
      },
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
          // pollAndDispatch main selection
          return [...state.steps.values()]
            .filter((s) => s.status === 'active' && s.leasedBy === null)
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
          // lease acquisition
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
    projectRuntime: { findUnique: async () => state.runtime },
    projectMode: { findFirst: async () => null },
    stepExecution: {
      aggregate: async (args: any) => {
        state.aggregateCalls.push(args)
        const projectId = args?.where?.step?.task?.projectId
        const gte: Date | undefined = args?.where?.startedAt?.gte
        const sum = state.executions
          .filter((e) => e.projectId === projectId && (!gte || e.startedAt >= gte))
          .reduce((acc, e) => acc + (e.cost ?? 0), 0)
        return { _sum: { cost: sum === 0 ? null : sum } }
      },
      findFirst: async (args: any) => {
        const rows = state.executions
          .filter((e) => e.stepId === args?.where?.stepId)
          .sort((a, b) => b.attempt - a.attempt)
        return rows[0] ?? null
      },
      findUnique: async (args: any) => state.executions.find((e) => e.id === args?.where?.id) ?? null,
      create: async (args: any) => {
        const { stepId, attempt } = args.data
        if (state.executions.some((e) => e.stepId === stepId && e.attempt === attempt)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        }
        const step = state.steps.get(stepId)
        const row: ExecRow = {
          id: `exec-${stepId}-${attempt}`,
          stepId,
          projectId: step ? state.tasks.get(step.taskId)!.projectId : 'unknown',
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
        return row
      },
      update: async (args: any) => {
        const row = state.executions.find((e) => e.id === args?.where?.id)
        if (!row) throw new Error(`no execution ${args?.where?.id}`)
        Object.assign(row, args?.data ?? {})
        return row
      },
    },
    stepEvent: { create: async () => ({ id: 'evt-1' }) },
    activityLog: {
      findFirst: async (args: any) => {
        const where = args?.where ?? {}
        const actions: string[] = where.action?.in ?? []
        const rows = state.activityLogs
          .filter((a) => a.projectId === where.projectId && actions.includes(a.action as string))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        return rows[0] ?? null
      },
      create: async (args: any) => {
        const row = { ...(args?.data ?? {}), createdAt: new Date() }
        state.activityLogs.push(row)
        return row
      },
    },
    stepArtifact: { createMany: async (args: any) => ({ count: (args?.data ?? []).length }) },
    deadLetterStep: { create: async () => ({ id: 'dl-1' }) },
  },
}))

const mockBroadcast = mock((projectId: string, event: string, payload: Record<string, unknown>) => {
  state.broadcasts.push({ projectId, event, payload })
  return Promise.resolve()
}) as any
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcast,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))
mock.module('@/lib/server/project-event', () => ({ fireProjectEvent: mockBroadcast }))

// Import AFTER mocks
import { pollAndDispatch } from '../step-queue'
import { setDispatchDeps, resetDispatchDeps } from '../dispatch'
import { getMonthToDateSpend } from '../budget'
import { updateProjectSchema } from '../contracts'

type AdapterParams = Record<string, any>
let adapterImpl: (params: AdapterParams) => Promise<Record<string, unknown>>
const adapterDispatch = mock((params: AdapterParams) => adapterImpl(params)) as any
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

function activities(action: string) {
  return state.activityLogs.filter((a) => a.action === action)
}

function broadcastsOf(event: string) {
  return state.broadcasts.filter((b) => b.event === event)
}

// ===========================================================================
// 1. TD-018 — cost wiring
// ===========================================================================

describe('TD-018 cost wiring', () => {
  test('adapter-reported cost lands on the execution row', async () => {
    const { stepId } = seedProject()
    adapterImpl = async () => ({ output: 'OUT', tokensUsed: 100, cost: 1.23 })

    await pollAndDispatch()

    const exec = state.executions.find((e) => e.stepId === stepId)
    expect(exec).toBeDefined()
    expect(exec!.status).toBe('succeeded')
    expect(exec!.cost).toBe(1.23)
    expect(exec!.tokensUsed).toBe(100)
  })

  test('tokens without adapter cost record the model estimate so budgets can bind', async () => {
    const { stepId } = seedProject({ model: 'claude-sonnet-4-5' })
    adapterImpl = async () => ({ output: 'OUT', tokensUsed: 1000 }) // no cost field

    await pollAndDispatch()

    const exec = state.executions.find((e) => e.stepId === stepId)
    // claude-sonnet blended rate: $6/M tokens → 1000 * 0.000006
    expect(exec!.cost).toBeCloseTo(0.006, 9)
  })

  test('unknown model with no adapter cost leaves cost null (no fake zeros)', async () => {
    const { stepId } = seedProject({ model: null })
    adapterImpl = async () => ({ output: 'OUT', tokensUsed: 1000 })

    await pollAndDispatch()

    const exec = state.executions.find((e) => e.stepId === stepId)
    expect(exec!.cost).toBeNull()
  })
})

// ===========================================================================
// 2. Budget enforcement in pollAndDispatch
// ===========================================================================

describe('budget enforcement', () => {
  test('a project at its budget is skipped with ONE budget_exceeded activity and a broadcast', async () => {
    const { projectId, stepId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 10) // month-to-date == budget

    await pollAndDispatch()

    // No dispatch: adapter untouched, step still active and unleased.
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    const step = state.steps.get(stepId)!
    expect(step.status).toBe('active')
    expect(step.leasedBy).toBeNull()

    // Exactly one durable activity + one board signal.
    const exceeded = activities('budget_exceeded')
    expect(exceeded).toHaveLength(1)
    expect(exceeded[0].projectId).toBe(projectId)
    expect(JSON.parse(exceeded[0].details as string)).toMatchObject({ budgetUsd: 10, spentUsd: 10 })
    const events = broadcastsOf('budget-exceeded')
    expect(events).toHaveLength(1)
    expect(events[0].projectId).toBe(projectId)
    expect(events[0].payload).toMatchObject({ budgetUsd: 10, spentUsd: 10 })
  })

  test('repeated ticks while paused do NOT write another budget_exceeded (per-episode dedupe)', async () => {
    const { projectId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 25)

    await pollAndDispatch()
    await pollAndDispatch()
    await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(activities('budget_exceeded')).toHaveLength(1)
    expect(broadcastsOf('budget-exceeded')).toHaveLength(1)
  })

  test('an under-budget project dispatches normally with no budget activity', async () => {
    const { projectId, stepId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 5)

    await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(stepId)!.status).toBe('done')
    expect(activities('budget_exceeded')).toHaveLength(0)
    expect(activities('budget_lifted')).toHaveLength(0)
  })

  test('no budget set → unchanged behaviour even with huge recorded spend (nullable column is the flag)', async () => {
    const { projectId, stepId } = seedProject({ budgetUsd: null })
    recordSpend(projectId, 1_000_000)

    await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(stepId)!.status).toBe('done')
    expect(activities('budget_exceeded')).toHaveLength(0)
    expect(state.broadcasts.filter((b) => b.event.startsWith('budget-'))).toHaveLength(0)
  })

  test('only the over-budget project is skipped — other projects in the same tick still dispatch', async () => {
    const over = seedProject({ budgetUsd: 10 })
    const under = seedProject({ budgetUsd: 100 })
    const unbudgeted = seedProject()
    recordSpend(over.projectId, 50)
    recordSpend(under.projectId, 1)

    await pollAndDispatch()

    expect(state.steps.get(over.stepId)!.status).toBe('active')
    expect(state.steps.get(under.stepId)!.status).toBe('done')
    expect(state.steps.get(unbudgeted.stepId)!.status).toBe('done')
    expect(activities('budget_exceeded')).toHaveLength(1)
  })

  test('raising the budget resumes dispatch next tick and writes budget_lifted once', async () => {
    const { projectId, stepId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 12)

    await pollAndDispatch() // pauses
    expect(adapterDispatch).toHaveBeenCalledTimes(0)
    expect(activities('budget_exceeded')).toHaveLength(1)

    // Operator raises the budget.
    state.projects.find((p) => p.id === projectId)!.budgetUsd = 50

    await pollAndDispatch() // resumes
    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(stepId)!.status).toBe('done')
    const lifted = activities('budget_lifted')
    expect(lifted).toHaveLength(1)
    expect(JSON.parse(lifted[0].details as string)).toMatchObject({ budgetUsd: 50, spentUsd: 12 })
    expect(broadcastsOf('budget-lifted')).toHaveLength(1)

    // Later ticks do not repeat budget_lifted.
    const second = seedProject() // fresh dispatchable step keeps the poll busy
    void second
    await pollAndDispatch()
    expect(activities('budget_lifted')).toHaveLength(1)
  })

  test('cost recorded last month (UTC) does not count toward this month', async () => {
    const { projectId, stepId } = seedProject({ budgetUsd: 10 })
    const now = new Date()
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1)
    recordSpend(projectId, 100, lastMonth)

    await pollAndDispatch()

    expect(adapterDispatch).toHaveBeenCalledTimes(1)
    expect(state.steps.get(stepId)!.status).toBe('done')
    expect(activities('budget_exceeded')).toHaveLength(0)

    // The aggregate window starts exactly at the UTC month boundary.
    const gte = (state.aggregateCalls[0] as any)?.where?.startedAt?.gte as Date
    expect(gte.toISOString()).toBe(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    )
  })
})

// ===========================================================================
// 3. getMonthToDateSpend helper
// ===========================================================================

describe('getMonthToDateSpend', () => {
  test('sums only this UTC month and treats a null sum as zero', async () => {
    const { projectId } = seedProject()
    expect(await getMonthToDateSpend(projectId)).toBe(0)

    recordSpend(projectId, 1.5)
    recordSpend(projectId, 2.25)
    const now = new Date()
    recordSpend(projectId, 99, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1))

    expect(await getMonthToDateSpend(projectId)).toBeCloseTo(3.75, 9)
  })
})

// ===========================================================================
// 4. Project update validation (budgetUsd via PUT /api/projects/[id])
// ===========================================================================

describe('updateProjectSchema budgetUsd validation', () => {
  test('accepts a positive budget, zero, and explicit null (budget removal)', () => {
    expect(updateProjectSchema.safeParse({ budgetUsd: 50 }).success).toBe(true)
    expect(updateProjectSchema.safeParse({ budgetUsd: 12.4 }).success).toBe(true)
    expect(updateProjectSchema.safeParse({ budgetUsd: 0 }).success).toBe(true)
    expect(updateProjectSchema.safeParse({ budgetUsd: null }).success).toBe(true)
  })

  test('rejects negative and non-numeric budgets', () => {
    expect(updateProjectSchema.safeParse({ budgetUsd: -1 }).success).toBe(false)
    expect(updateProjectSchema.safeParse({ budgetUsd: '50' }).success).toBe(false)
    expect(updateProjectSchema.safeParse({ budgetUsd: Number.NaN }).success).toBe(false)
  })
})
