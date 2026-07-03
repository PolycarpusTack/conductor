import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test'

// ===========================================================================
// C-4 — Notification center emit points + optional email.
//
// Covers:
//   - a human gate becoming active (advanceChain → activateStep) creates ONE
//     review_gate_waiting notification + a 'notification-created' broadcast
//   - a chain whose ROOT step is a human gate (startChain) notifies too
//   - non-human step transitions create NO notification
//   - retry exhaustion (moveToDeadLetter site in dispatch) creates ONE
//     dead_letter notification
//   - budget pause creates ONE budget_exceeded notification per pause
//     episode (same dedupe as the budget_exceeded activity)
//   - email: skipped silently when SMTP_HOST / NOTIFY_EMAIL_TO are unset,
//     attempted (mock transport) when configured, errors swallowed
//   - createNotification never throws when the notification write fails
//
// Same conventions as budget-enforcement.test.ts: stateful fake db via
// mock.module ('@/lib/db' + realtime + project-event), adapter/memory/MCP
// substituted through the dispatchDeps seams, resetDispatchDeps in afterAll.
// The SMTP transport is substituted through the notificationDeps seam.
// ===========================================================================

type StepRow = {
  id: string
  taskId: string
  order: number
  status: string
  mode: string
  humanLabel: string | null
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
  projectId: string
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

type NotificationRow = {
  id: string
  projectId: string | null
  type: string
  title: string
  body: string | null
  taskId: string | null
  readAt: Date | null
  createdAt: Date
}

const state = {
  projects: [] as Array<{ id: string; budgetUsd: number | null }>,
  tasks: new Map<string, TaskRow>(),
  steps: new Map<string, StepRow>(),
  agents: new Map<string, Record<string, unknown>>(),
  runtime: { id: 'rt-1', adapter: 'fake', config: null, apiKeyEnvVar: null, endpoint: null } as Record<string, unknown> | null,
  executions: [] as ExecRow[],
  activityLogs: [] as Array<Record<string, unknown> & { createdAt: Date; seq: number }>,
  activitySeq: 0,
  notifications: [] as NotificationRow[],
  broadcasts: [] as Array<{ projectId: string; event: string; payload: Record<string, unknown> }>,
  failNotificationCreate: false,
  notifSeq: 0,
  execSeq: 0,
}

let projectCounter = 0

function makeStep(overrides: Partial<StepRow> & { id: string; taskId: string; order: number }): StepRow {
  return {
    status: 'pending',
    mode: 'develop',
    humanLabel: null,
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
    agentId: null,
    leasedBy: null,
    leasedAt: null,
    output: null,
    error: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** Seeds one project with one task, one agent, and one active agent step. */
function seedProject(opts: { budgetUsd?: number | null } = {}) {
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
    runtimeModel: null,
    invocationMode: 'HTTP',
    isActive: true,
  })
  state.steps.set(stepId, makeStep({ id: stepId, taskId, order: 1, status: 'active', agentId }))
  return { projectId, taskId, agentId, stepId }
}

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
  state.activitySeq = 0
  state.notifications = []
  state.broadcasts = []
  state.failNotificationCreate = false
  state.notifSeq = 0
  state.execSeq = 0
  projectCounter = 0
}

mock.module('@/lib/db', () => ({
  db: {
    daemon: { findMany: async () => [] },
    project: {
      findMany: async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? []
        return state.projects
          .filter((p) => ids.includes(p.id) && p.budgetUsd !== null)
          .map((p) => ({ id: p.id, budgetUsd: p.budgetUsd }))
      },
    },
    task: {
      findUnique: async (args: any) => {
        const row = state.tasks.get(args?.where?.id)
        if (!row) return null
        if (args?.select?.title) return { title: row.title }
        return { ...row }
      },
      update: async () => ({}),
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
          return [...state.steps.values()]
            .filter((s) => s.status === 'active' && s.leasedBy === null)
            .map((s) => ({
              id: s.id,
              agent: { invocationMode: state.agents.get(s.agentId!)?.invocationMode ?? 'HTTP' },
              task: { projectId: state.tasks.get(s.taskId)!.projectId },
            }))
        }
        if (where.status === 'pending') return []
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
    projectRuntime: { findUnique: async () => state.runtime },
    projectMode: { findFirst: async () => null },
    stepExecution: {
      aggregate: async (args: any) => {
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
          // seq tie-break: rows created within the same millisecond must
          // still resolve newest-last-written (matches cuid-ordered reality).
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq)
        return rows[0] ?? null
      },
      create: async (args: any) => {
        state.activitySeq += 1
        const row = { ...(args?.data ?? {}), createdAt: new Date(), seq: state.activitySeq }
        state.activityLogs.push(row)
        return row
      },
    },
    notification: {
      create: async (args: any) => {
        if (state.failNotificationCreate) throw new Error('notification table unavailable')
        state.notifSeq += 1
        const row: NotificationRow = {
          id: `notif-${state.notifSeq}`,
          projectId: args?.data?.projectId ?? null,
          type: args?.data?.type,
          title: args?.data?.title,
          body: args?.data?.body ?? null,
          taskId: args?.data?.taskId ?? null,
          readAt: null,
          createdAt: new Date(),
        }
        state.notifications.push(row)
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
import { advanceChain, startChain, setDispatchDeps, resetDispatchDeps } from '../dispatch'
import { filterBudgetPausedProjects } from '../budget'
import {
  createNotification,
  sendNotificationEmail,
  setNotificationDeps,
  resetNotificationDeps,
} from '../notifications'

type AdapterParams = Record<string, any>
let adapterImpl: (params: AdapterParams) => Promise<Record<string, unknown>>
const adapterDispatch = mock((params: AdapterParams) => adapterImpl(params)) as any
const fakeAdapter = { id: 'fake', name: 'Fake Adapter', available: true, dispatch: adapterDispatch }

const sendMail = mock(() => Promise.resolve({ messageId: 'test' })) as any
const createTransport = mock(() => ({ sendMail })) as any

const EMAIL_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'NOTIFY_EMAIL_TO', 'NOTIFY_EMAIL_FROM']

beforeEach(() => {
  resetState()
  for (const key of EMAIL_ENV) delete process.env[key]
  adapterImpl = async () => ({ output: 'OUT', tokensUsed: 42 })
  adapterDispatch.mockClear()
  mockBroadcast.mockClear()
  sendMail.mockClear()
  sendMail.mockResolvedValue({ messageId: 'test' })
  createTransport.mockClear()
  setNotificationDeps({ createSmtpTransport: createTransport })
  setDispatchDeps({
    getAdapter: () => fakeAdapter as any,
    buildWorkingMemory: (async () => '') as any,
    buildRelevantMemoryWithHits: (async () => ({ text: '', hits: [] })) as any,
    resolveMcpTools: (async () => []) as any,
  })
})

afterAll(() => {
  resetDispatchDeps()
  resetNotificationDeps()
  for (const key of EMAIL_ENV) delete process.env[key]
})

function notificationsOf(type: string) {
  return state.notifications.filter((n) => n.type === type)
}

function broadcastsOf(event: string) {
  return state.broadcasts.filter((b) => b.event === event)
}

/** Lets fire-and-forget email sends settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ===========================================================================
// 1. Human gate activation → review_gate_waiting
// ===========================================================================

describe('review gate waiting notifications', () => {
  test('advancing onto a human gate creates ONE notification + broadcast', async () => {
    const { projectId, taskId, stepId } = seedProject()
    // Step 1 done (agent), step 2 is the human gate becoming active.
    state.steps.get(stepId)!.status = 'done'
    state.steps.get(stepId)!.output = 'agent output'
    state.steps.set('gate-1', makeStep({
      id: 'gate-1',
      taskId,
      order: 2,
      status: 'pending',
      mode: 'human',
      humanLabel: 'Reviewer',
      agentId: null,
      autoContinue: false,
    }))

    await advanceChain(taskId, projectId)

    const gate = state.steps.get('gate-1')!
    expect(gate.status).toBe('active')

    const notifs = notificationsOf('review_gate_waiting')
    expect(notifs).toHaveLength(1)
    expect(notifs[0].projectId).toBe(projectId)
    expect(notifs[0].taskId).toBe(taskId)
    expect(notifs[0].title).toContain('Task 1')
    expect(notifs[0].body).toContain('Reviewer')

    const events = broadcastsOf('notification-created')
    expect(events).toHaveLength(1)
    expect(events[0].projectId).toBe(projectId)
    expect((events[0].payload as any).notification).toMatchObject({ type: 'review_gate_waiting', taskId })
  })

  test('a chain whose root step is a human gate notifies on startChain', async () => {
    const { projectId, taskId, stepId } = seedProject()
    const root = state.steps.get(stepId)!
    root.status = 'pending'
    root.mode = 'human'
    root.humanLabel = 'Sign-off'
    root.agentId = null

    await startChain(taskId, projectId)

    expect(state.steps.get(stepId)!.status).toBe('active')
    const notifs = notificationsOf('review_gate_waiting')
    expect(notifs).toHaveLength(1)
    expect(notifs[0].body).toContain('Sign-off')
  })

  test('non-human step transitions create NO notification', async () => {
    const { projectId, taskId, agentId, stepId } = seedProject()
    state.steps.get(stepId)!.status = 'done'
    state.steps.set('next-1', makeStep({
      id: 'next-1',
      taskId,
      order: 2,
      status: 'pending',
      mode: 'develop',
      agentId,
    }))

    await advanceChain(taskId, projectId)

    expect(state.steps.get('next-1')!.status).toBe('active')
    expect(state.notifications).toHaveLength(0)
    expect(broadcastsOf('notification-created')).toHaveLength(0)
  })
})

// ===========================================================================
// 2. Dead-letter → dead_letter
// ===========================================================================

describe('dead-letter notifications', () => {
  test('retry exhaustion creates ONE dead_letter notification with the error', async () => {
    const { projectId, taskId, stepId } = seedProject()
    adapterImpl = async () => {
      throw new Error('boom from adapter')
    }

    await pollAndDispatch()

    expect(state.steps.get(stepId)!.status).toBe('failed')
    const notifs = notificationsOf('dead_letter')
    expect(notifs).toHaveLength(1)
    expect(notifs[0].projectId).toBe(projectId)
    expect(notifs[0].taskId).toBe(taskId)
    expect(notifs[0].title).toContain('Task 1')
    expect(notifs[0].body).toContain('boom from adapter')
    expect(broadcastsOf('notification-created')).toHaveLength(1)
  })

  test('a successful step creates no notification', async () => {
    const { stepId } = seedProject()

    await pollAndDispatch()

    expect(state.steps.get(stepId)!.status).toBe('done')
    expect(state.notifications).toHaveLength(0)
  })
})

// ===========================================================================
// 3. Budget pause → budget_exceeded (once per episode)
// ===========================================================================

describe('budget notifications', () => {
  test('a budget pause creates ONE budget_exceeded notification per episode', async () => {
    const { projectId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 25)

    await pollAndDispatch()
    await pollAndDispatch()
    await pollAndDispatch()

    const notifs = notificationsOf('budget_exceeded')
    expect(notifs).toHaveLength(1)
    expect(notifs[0].projectId).toBe(projectId)
    expect(notifs[0].body).toContain('10')
    expect(notifs[0].body).toContain('25')
    expect(broadcastsOf('notification-created')).toHaveLength(1)
  })

  test('under-budget and unbudgeted projects create no budget notification', async () => {
    const under = seedProject({ budgetUsd: 100 })
    recordSpend(under.projectId, 1)
    seedProject({ budgetUsd: null })

    await pollAndDispatch()

    expect(notificationsOf('budget_exceeded')).toHaveLength(0)
  })

  test('a new pause episode after a lift notifies again', async () => {
    const { projectId } = seedProject({ budgetUsd: 10 })
    recordSpend(projectId, 12)

    await filterBudgetPausedProjects([projectId]) // pause #1
    state.projects.find((p) => p.id === projectId)!.budgetUsd = 50
    await filterBudgetPausedProjects([projectId]) // lift
    recordSpend(projectId, 60)
    await filterBudgetPausedProjects([projectId]) // pause #2

    expect(notificationsOf('budget_exceeded')).toHaveLength(2)
  })
})

// ===========================================================================
// 4. Email delivery (optional per instance)
// ===========================================================================

describe('notification email', () => {
  test('skipped silently when SMTP/NOTIFY_EMAIL_TO are not configured', async () => {
    await sendNotificationEmail('dead_letter', 'A title', 'A body')
    expect(createTransport).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  test('skipped when only SMTP_HOST is set (recipient missing)', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    await sendNotificationEmail('dead_letter', 'A title', 'A body')
    expect(sendMail).not.toHaveBeenCalled()
  })

  test('attempted when configured: transport built from SMTP_* and mail sent to NOTIFY_EMAIL_TO', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.SMTP_PORT = '2525'
    process.env.SMTP_USER = 'mailer'
    process.env.SMTP_PASS = 'secret'
    process.env.NOTIFY_EMAIL_TO = 'operator@example.test'

    await sendNotificationEmail('budget_exceeded', 'Budget exceeded', 'Spend $25 of $10')

    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(createTransport.mock.calls[0][0]).toMatchObject({
      host: 'smtp.example.test',
      port: 2525,
      user: 'mailer',
      pass: 'secret',
    })
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mailArgs = sendMail.mock.calls[0][0]
    expect(mailArgs.to).toBe('operator@example.test')
    expect(mailArgs.subject).toContain('Budget exceeded')
    expect(mailArgs.text).toContain('Spend $25 of $10')
  })

  test('a failing SMTP send never throws (fire-and-forget with error logging)', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.NOTIFY_EMAIL_TO = 'operator@example.test'
    sendMail.mockRejectedValueOnce(new Error('SMTP 5xx'))

    await sendNotificationEmail('dead_letter', 'A title', null)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  test('createNotification triggers the email when configured — and still stores in-app', async () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    process.env.NOTIFY_EMAIL_TO = 'operator@example.test'

    await createNotification({
      projectId: 'proj-x',
      type: 'dead_letter',
      title: 'Step dead-lettered',
      body: 'the details',
      taskId: 'task-x',
    })
    await settle()

    expect(state.notifications).toHaveLength(1)
    expect(broadcastsOf('notification-created')).toHaveLength(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  test('createNotification stores in-app even when email is unconfigured', async () => {
    await createNotification({ projectId: 'proj-x', type: 'budget_exceeded', title: 'Budget exceeded' })
    await settle()

    expect(state.notifications).toHaveLength(1)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 5. Robustness
// ===========================================================================

describe('createNotification robustness', () => {
  test('never throws when the notification write fails — and does not broadcast', async () => {
    state.failNotificationCreate = true

    await createNotification({ projectId: 'proj-x', type: 'dead_letter', title: 'x' })

    expect(state.notifications).toHaveLength(0)
    expect(broadcastsOf('notification-created')).toHaveLength(0)
  })

  test('dispatch survives a broken notification table (dead-letter path)', async () => {
    const { stepId } = seedProject()
    state.failNotificationCreate = true
    adapterImpl = async () => {
      throw new Error('boom')
    }

    await pollAndDispatch()

    expect(state.steps.get(stepId)!.status).toBe('failed')
    expect(state.notifications).toHaveLength(0)
  })
})
