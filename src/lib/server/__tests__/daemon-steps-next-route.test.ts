import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/daemon/steps/next/route.ts (poll endpoint)
//
// A-1-T2 contract test, both directions:
//   server → wire: the response carries the full Execution Payload
//   (payloadVersion, systemPrompt, instructions, step.mode, agent.runtimeModel)
//   wire → daemon: the same payload passes the daemon runner's
//   validateExecutionPayload guard (imported from the daemon package).
//
// NOTE: resolveRuntime (daemon-dispatch) and appendStepEvent (step-events)
// are NOT module-mocked — they have real unit tests / run fine against the
// db mock (shared mock.module registry rule).
// ---------------------------------------------------------------------------

const mockStepFindFirst = mock(() => Promise.resolve(null)) as any
const mockTaskFindUnique = mock(() => Promise.resolve(null)) as any
const mockStepEventFindFirst = mock(() => Promise.resolve(null)) as any
const mockStepEventCreate = mock(() => Promise.resolve({ id: 'evt-1' })) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findFirst: mockStepFindFirst,
      // G1-1-T3: buildResolvedPrompt looks up predecessor output (DAG path).
      findMany: () => Promise.resolve([]),
      // G1-1-T4: startedAt stamp on the first attempt.
      updateMany: () => Promise.resolve({ count: 1 }),
    },
    task: {
      findUnique: mockTaskFindUnique,
    },
    // G1-1-T3: buildResolvedPrompt reads the project mode for label/instructions.
    projectMode: { findFirst: () => Promise.resolve(null) },
    // G1-1-T4: the poll route creates the StepExecution row for the attempt.
    stepExecution: {
      findFirst: () => Promise.resolve(null),
      create: () => Promise.resolve({ id: 'exec-1' }),
    },
    stepEvent: {
      findFirst: mockStepEventFindFirst,
      create: mockStepEventCreate,
    },
  },
  isPostgresDb: false,
}))

const mockResolveDaemonByToken = mock(() => Promise.resolve(null)) as any
const mockExtractDaemonToken = mock(() => 'fake-token') as any

// Full export surface — bun's mock.module registry is shared across files
mock.module('@/lib/server/daemon-auth', () => ({
  extractDaemonToken: mockExtractDaemonToken,
  resolveDaemonByToken: mockResolveDaemonByToken,
  generateDaemonToken: () => ({ rawToken: 'mock', hash: 'mock', preview: 'mock' }),
  updateDaemonHeartbeat: () => Promise.resolve(),
  markDaemonOffline: () => Promise.resolve(),
  markStaleDaemons: () => Promise.resolve(),
  sweepStaleDaemonsThrottled: () => Promise.resolve(),
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined),
  isRealtimeConfigured: () => false,
  createRealtimeToken: () => 'mock-token',
  verifyRealtimeToken: () => null,
}))

// Import AFTER all mocks are in place
import { GET } from '@/app/api/daemon/steps/next/route'
// G1-1-T3: the route now resolves prompts via dispatch.buildResolvedPrompt, which
// builds memory through dispatchDeps. Stub those deps (no module mock → no
// shared-registry leak, TD-014b) so resolution is deterministic and DB-free.
import { setDispatchDeps, resetDispatchDeps } from '@/lib/server/dispatch'
// Daemon-side contract guard — the "other direction" of the contract test.
import { validateExecutionPayload } from '../../../../mini-services/conductor-daemon/runner'

const DAEMON = { id: 'daemon-1', workspaceId: 'ws-1', hostname: 'devbox', status: 'online', hostId: 'host-1' }

function leasedStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    taskId: 'task-1',
    order: 0,
    mode: 'develop',
    instructions: 'Implement the calendar view.',
    timeoutMs: 60_000,
    retryDelayMs: 5000,
    maxRetries: 3,
    attempts: 0,
    agentId: 'agent-1',
    traceContext: null,
    leasedAt: new Date('2026-07-03T10:00:00Z'),
    agent: {
      id: 'agent-1',
      name: 'Builder',
      systemPrompt: 'You are Builder.',
      modeInstructions: JSON.stringify({ develop: 'Write production-grade code.' }),
      mcpConnectionIds: null,
      runtimeModel: 'claude-sonnet-4-5',
      runtime: {
        adapter: 'claude-code',
        config: JSON.stringify({
          sessionPolicy: 'ephemeral',
          sessionBackend: 'process',
          commandTemplate: 'mycli --model {{agent.runtimeModel}} --step {{step.id}}',
        }),
      },
    },
    task: {
      id: 'task-1',
      title: 'Build calendar',
      description: 'A month grid.',
      projectId: 'p-1',
      runtimeOverride: null,
    },
    ...overrides,
  }
}

beforeEach(() => {
  mockStepFindFirst.mockReset()
  mockStepFindFirst.mockResolvedValue(leasedStep())
  mockTaskFindUnique.mockReset()
  mockTaskFindUnique.mockResolvedValue({ runtimeOverride: null })
  mockStepEventFindFirst.mockReset()
  mockStepEventFindFirst.mockResolvedValue(null)
  mockStepEventCreate.mockReset()
  mockStepEventCreate.mockResolvedValue({ id: 'evt-1' })
  mockResolveDaemonByToken.mockReset()
  mockResolveDaemonByToken.mockResolvedValue(DAEMON)
  mockExtractDaemonToken.mockReset()
  mockExtractDaemonToken.mockReturnValue('fake-token')
  // Deterministic, DB-free memory for buildResolvedPrompt (G1-1-T3).
  setDispatchDeps({
    buildWorkingMemory: async () => '',
    buildRelevantMemoryWithHits: async () => ({ text: '', hits: [] }),
  })
})

afterEach(() => {
  resetDispatchDeps()
})

function makeRequest(): Request {
  return new Request('http://localhost/api/daemon/steps/next', {
    headers: { Authorization: 'Bearer fake-token' },
  })
}

const params = { params: Promise.resolve({}) }

describe('GET /api/daemon/steps/next — execution payload contract', () => {
  test('carries payloadVersion 2 and everything the runner needs', async () => {
    const res = await GET(makeRequest(), params)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.step.payloadVersion).toBe(2)
    // Runner inputs (A-1): systemPrompt + instructions + step.mode + agent.runtimeModel
    expect(body.step.mode).toBe('develop')
    expect(body.step.instructions).toBe('Implement the calendar view.')
    expect(body.step.agent.systemPrompt).toBe('You are Builder.')
    expect(body.step.agent.modeInstructions).toContain('production-grade')
    expect(body.step.agent.runtimeModel).toBe('claude-sonnet-4-5')
    // G1-1-T3: previousOutput present (null when there is no predecessor).
    expect(body.step).toHaveProperty('previousOutput')
    // Task context for prompt composition
    expect(body.step.task).toMatchObject({ id: 'task-1', title: 'Build calendar', description: 'A month grid.' })
    // Session block with the resolved command template
    expect(body.step.session.sessionKey).toBe('step-step-1')
    expect(body.step.session.command).toBe('mycli --model claude-sonnet-4-5 --step step-1')
    expect(body.step.session.commandError).toBeNull()
    expect(body.step.timeoutMs).toBe(60_000)
  })

  // G1-2 (gap 1.3): a rewound daemon step must carry the reviewer's rejection
  // note so the re-run can address it (else it re-runs the identical prompt).
  test('carries the rejection note when the step has one, absent otherwise', async () => {
    mockStepFindFirst.mockResolvedValue(leasedStep({ rejectionNote: 'Fix the off-by-one.', attempts: 1 }))
    let body = await (await GET(makeRequest(), params)).json()
    expect(body.step.rejectionNote).toBe('Fix the off-by-one.')

    mockStepFindFirst.mockResolvedValue(leasedStep({ rejectionNote: null }))
    body = await (await GET(makeRequest(), params)).json()
    expect(body.step.rejectionNote).toBeNull()
  })

  // G1-1-T3 (gap 1.1): prompt tokens are resolved server-side — the daemon must
  // never receive a literal {{task.title}} to hand to the CLI.
  test('resolves prompt tokens in systemPrompt and instructions', async () => {
    const step = leasedStep()
    step.agent.systemPrompt = 'You are Builder. Working on {{task.title}}.'
    step.instructions = 'Finish {{task.title}} now.'
    mockStepFindFirst.mockResolvedValue(step)

    const res = await GET(makeRequest(), params)
    const body = await res.json()
    expect(body.step.agent.systemPrompt).toBe('You are Builder. Working on Build calendar.')
    expect(body.step.instructions).toBe('Finish Build calendar now.')
    expect(body.step.agent.systemPrompt).not.toContain('{{')
    expect(body.step.instructions).not.toContain('{{')
  })

  test('the payload passes the daemon runner contract guard (both directions)', async () => {
    const res = await GET(makeRequest(), params)
    const body = await res.json()
    expect(validateExecutionPayload(body.step)).toEqual([])
  })

  test('a template with unknown tokens is rejected loudly: command null + commandError', async () => {
    const step = leasedStep()
    ;(step.agent.runtime as { config: string }).config = JSON.stringify({
      commandTemplate: 'mycli {{agent.runtimeModel}} {{evil.injection}} {{another.bad}}',
    })
    mockStepFindFirst.mockResolvedValue(step)

    const res = await GET(makeRequest(), params)
    const body = await res.json()
    expect(body.step.session.command).toBeNull()
    expect(body.step.session.commandError).toContain('evil.injection')
    expect(body.step.session.commandError).toContain('another.bad')
    // Still a valid payload — the daemon fails the step with the loud error.
    expect(validateExecutionPayload(body.step)).toEqual([])
  })

  test('agent-less steps still produce a valid payload', async () => {
    mockStepFindFirst.mockResolvedValue(leasedStep({ agent: null, agentId: null }))
    const res = await GET(makeRequest(), params)
    const body = await res.json()
    expect(body.step.payloadVersion).toBe(2)
    expect(body.step.agent).toBeNull()
    expect(validateExecutionPayload(body.step)).toEqual([])
  })

  test('returns { step: null } when nothing is leased', async () => {
    mockStepFindFirst.mockResolvedValue(null)
    const res = await GET(makeRequest(), params)
    const body = await res.json()
    expect(body.step).toBeNull()
  })

  test('401 without a daemon token', async () => {
    mockExtractDaemonToken.mockReturnValue(null)
    const res = await GET(makeRequest(), params)
    expect(res.status).toBe(401)
  })
})
