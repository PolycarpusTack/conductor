import { describe, test, expect, mock, beforeEach } from 'bun:test'

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
    },
    task: {
      findUnique: mockTaskFindUnique,
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
})

function makeRequest(): Request {
  return new Request('http://localhost/api/daemon/steps/next', {
    headers: { Authorization: 'Bearer fake-token' },
  })
}

const params = { params: Promise.resolve({}) }

describe('GET /api/daemon/steps/next — execution payload contract', () => {
  test('carries payloadVersion 1 and everything the runner needs', async () => {
    const res = await GET(makeRequest(), params)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.step.payloadVersion).toBe(1)
    // Runner inputs (A-1): systemPrompt + instructions + step.mode + agent.runtimeModel
    expect(body.step.mode).toBe('develop')
    expect(body.step.instructions).toBe('Implement the calendar view.')
    expect(body.step.agent.systemPrompt).toBe('You are Builder.')
    expect(body.step.agent.modeInstructions).toContain('production-grade')
    expect(body.step.agent.runtimeModel).toBe('claude-sonnet-4-5')
    // Task context for prompt composition
    expect(body.step.task).toMatchObject({ id: 'task-1', title: 'Build calendar', description: 'A month grid.' })
    // Session block with the resolved command template
    expect(body.step.session.sessionKey).toBe('step-step-1')
    expect(body.step.session.command).toBe('mycli --model claude-sonnet-4-5 --step step-1')
    expect(body.step.session.commandError).toBeNull()
    expect(body.step.timeoutMs).toBe(60_000)
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
    expect(body.step.payloadVersion).toBe(1)
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
