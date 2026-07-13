import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: src/app/api/daemon/steps/route.ts (completion endpoint)
//
// Epic 3 additions under test: optional sessionId linkage (ownership-checked)
// and succeeded/failed/retry_scheduled step events on the daemon path.
//
// NOTE: the route imports the REAL dispatch module (advanceChain /
// resolveTaskStatus) — dispatch has its own real unit tests and must not be
// module-mocked. The db mock therefore also satisfies dispatch's queries.
// ---------------------------------------------------------------------------

const mockStepFindUnique = mock(() => Promise.resolve(null)) as any
const mockStepUpdate = mock(() => Promise.resolve({})) as any
const mockStepFindMany = mock(() => Promise.resolve([])) as any
const mockTaskUpdate = mock(() => Promise.resolve({})) as any
const mockSessionFindUnique = mock(() => Promise.resolve(null)) as any
const mockSessionUpdate = mock(() => Promise.resolve({})) as any
const mockStepEventCreate = mock(() => Promise.resolve({ id: 'evt-1' })) as any
const mockArtifactCreate = mock(() => Promise.resolve({ id: 'art-1' })) as any
const mockDeadLetterCreate = mock(() => Promise.resolve({ id: 'dl-1' })) as any
const mockNotificationCreate = mock(() => Promise.resolve({ id: 'notif-1' })) as any
const mockExecFindFirst = mock(() => Promise.resolve(null)) as any
const mockExecCreate = mock(() => Promise.resolve({ id: 'exec-1' })) as any
const mockExecFindUnique = mock(() => Promise.resolve({ startedAt: new Date('2026-07-12T10:00:00Z') })) as any
const mockExecUpdate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findUnique: mockStepFindUnique,
      update: mockStepUpdate,
      findMany: mockStepFindMany,
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    task: {
      update: mockTaskUpdate,
      findUnique: () => Promise.resolve(null),
    },
    agentSession: {
      findUnique: mockSessionFindUnique,
      update: mockSessionUpdate,
    },
    stepEvent: {
      create: mockStepEventCreate,
      findFirst: () => Promise.resolve(null),
    },
    stepArtifact: {
      create: mockArtifactCreate,
    },
    // G1-1-T2: the Finalizer's terminal branch dead-letters + notifies.
    deadLetterStep: { create: mockDeadLetterCreate },
    notification: { create: mockNotificationCreate },
    // G1-1-T4: StepExecution row per daemon attempt (cost/budget binding).
    stepExecution: {
      findFirst: mockExecFindFirst,
      create: mockExecCreate,
      findUnique: mockExecFindUnique,
      update: mockExecUpdate,
    },
    activityLog: { create: () => Promise.resolve({}) },
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
import { POST } from '@/app/api/daemon/steps/route'

const DAEMON = { id: 'daemon-1', workspaceId: 'ws-1', hostname: 'devbox', status: 'online', hostId: 'host-1' }

const LEASED_STEP = {
  id: 'step-1',
  taskId: 'task-1',
  status: 'active',
  leasedBy: 'daemon-1',
  agentId: 'agent-1',
  mode: 'develop',
  instructions: 'do the thing',
  maxRetries: 2,
  retryDelayMs: 5000,
  fallbackAgentId: null,
  attempts: 0,
  task: { projectId: 'p-1', title: 'Task One' },
}

beforeEach(() => {
  mockStepFindUnique.mockReset()
  mockStepFindUnique.mockResolvedValue(LEASED_STEP)
  mockStepUpdate.mockReset()
  mockStepUpdate.mockResolvedValue({})
  mockStepFindMany.mockReset()
  mockStepFindMany.mockResolvedValue([])
  mockSessionFindUnique.mockReset()
  mockSessionFindUnique.mockResolvedValue(null)
  mockSessionUpdate.mockReset()
  mockSessionUpdate.mockResolvedValue({})
  mockStepEventCreate.mockReset()
  mockStepEventCreate.mockResolvedValue({ id: 'evt-1' })
  mockArtifactCreate.mockReset()
  mockArtifactCreate.mockResolvedValue({ id: 'art-1' })
  mockDeadLetterCreate.mockReset()
  mockDeadLetterCreate.mockResolvedValue({ id: 'dl-1' })
  mockNotificationCreate.mockReset()
  mockNotificationCreate.mockResolvedValue({ id: 'notif-1' })
  mockExecFindFirst.mockReset()
  mockExecFindFirst.mockResolvedValue(null)
  mockExecCreate.mockReset()
  mockExecCreate.mockResolvedValue({ id: 'exec-1' })
  mockExecFindUnique.mockReset()
  mockExecFindUnique.mockResolvedValue({ startedAt: new Date('2026-07-12T10:00:00Z') })
  mockExecUpdate.mockReset()
  mockExecUpdate.mockResolvedValue({})
  mockResolveDaemonByToken.mockReset()
  mockResolveDaemonByToken.mockResolvedValue(DAEMON)
  mockExtractDaemonToken.mockReset()
  mockExtractDaemonToken.mockReturnValue('fake-token')
})

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/daemon/steps', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({}) }

function eventsOfType(type: string) {
  return mockStepEventCreate.mock.calls.filter((c: any[]) => c[0].data.event === type)
}

describe('POST /api/daemon/steps — session linkage', () => {
  test('403 when sessionId belongs to another daemon', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', daemonId: 'daemon-OTHER', taskId: null, stepId: null,
    })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', sessionId: 'sess-1' }),
      params,
    )
    expect(res.status).toBe(403)
    expect(mockStepUpdate).not.toHaveBeenCalled()
  })

  test('404 when sessionId is unknown', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', sessionId: 'nope' }),
      params,
    )
    expect(res.status).toBe(404)
  })

  test('stamps task/step on an owned, unlinked session', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', daemonId: 'daemon-1', taskId: null, stepId: null,
    })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', sessionId: 'sess-1' }),
      params,
    )
    expect(res.status).toBe(200)
    const update = mockSessionUpdate.mock.calls[0][0]
    expect(update.data.stepId).toBe('step-1')
    expect(update.data.taskId).toBe('task-1')
  })
})

describe('POST /api/daemon/steps — step events', () => {
  test('complete appends a succeeded event carrying the sessionId', async () => {
    mockSessionFindUnique.mockResolvedValue({
      id: 'sess-1', daemonId: 'daemon-1', taskId: 'task-1', stepId: 'step-1',
    })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', sessionId: 'sess-1' }),
      params,
    )
    expect(res.status).toBe(200)
    const succeeded = eventsOfType('succeeded')
    expect(succeeded).toHaveLength(1)
    const data = JSON.parse(succeeded[0][0].data.data)
    expect(data.source).toBe('daemon')
    expect(data.sessionId).toBe('sess-1')
  })

  test('fail with attempts remaining appends failed + retry_scheduled events', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: true }),
      params,
    )
    expect(res.status).toBe(200)
    expect(eventsOfType('failed')).toHaveLength(1)
    expect(eventsOfType('retry_scheduled')).toHaveLength(1)
    const failData = JSON.parse(eventsOfType('failed')[0][0].data.data)
    expect(failData.error).toBe('boom')
    expect(failData.attempt).toBe(1)
    expect(failData.source).toBe('daemon')
  })

  // G1-1-T2 (ADR-0008): the SERVER decides retry vs terminal from the step's own
  // maxRetries — the daemon's willRetry is a hint we ignore. With attempts left,
  // willRetry:false must STILL retry (the reference daemon always sends false).
  test('server retries despite willRetry:false when attempts remain (hint ignored)', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: false }),
      params,
    )
    expect(res.status).toBe(200)
    expect(eventsOfType('retry_scheduled')).toHaveLength(1)
    expect(mockDeadLetterCreate).not.toHaveBeenCalled()
  })

  // Exhaustion (attempt maxRetries+1) → terminal regardless of willRetry:true.
  test('exhausted retries dead-letter + notify, even with willRetry:true', async () => {
    mockStepFindUnique.mockResolvedValue({ ...LEASED_STEP, attempts: 2 }) // next attempt = 3 = maxRetries+1
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: true }),
      params,
    )
    expect(res.status).toBe(200)
    expect(eventsOfType('failed')).toHaveLength(1)
    expect(eventsOfType('retry_scheduled')).toHaveLength(0)
    expect(mockDeadLetterCreate).toHaveBeenCalledTimes(1) // TD-025: now visible in the panel
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1) // and the bell
    const dl = mockDeadLetterCreate.mock.calls[0][0].data
    expect(dl.originalStepId).toBe('step-1')
    expect(dl.lastError).toBe('boom')
  })

  test('403 when step is leased by another daemon', async () => {
    mockStepFindUnique.mockResolvedValue({ ...LEASED_STEP, leasedBy: 'daemon-OTHER' })
    const res = await POST(makeRequest({ stepId: 'step-1', action: 'complete', output: 'x' }), params)
    expect(res.status).toBe(403)
    expect(mockStepEventCreate).not.toHaveBeenCalled()
  })

  // G1-1-T4 (TD-018b): a completed daemon attempt finalizes a StepExecution row
  // carrying the cost lifted from the 'claude run metadata' artifact, so daemon
  // spend binds budgets.
  test('complete finalizes a StepExecution with cost from the metadata artifact', async () => {
    const res = await POST(
      makeRequest({
        stepId: 'step-1',
        action: 'complete',
        output: 'built it',
        artifacts: [
          {
            type: 'json',
            label: 'claude run metadata',
            content: '{"totalCostUsd":0.0421}',
            metadata: { totalCostUsd: 0.0421, numTurns: 3, claudeSessionId: 'sess-x' },
          },
        ],
      }),
      params,
    )
    expect(res.status).toBe(200)
    // succeedExecution reads startedAt then updates with the cost.
    expect(mockExecUpdate).toHaveBeenCalledTimes(1)
    const update = mockExecUpdate.mock.calls[0][0]
    expect(update.data.status).toBe('succeeded')
    expect(update.data.cost).toBe(0.0421)
  })

  test('fail finalizes the StepExecution row too (cost path binds for failures)', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: false }),
      params,
    )
    expect(res.status).toBe(200)
    // failExecution updates the row to 'failed' (attempt 1 retries, but the row is finalized).
    expect(mockExecUpdate).toHaveBeenCalled()
  })
})

// G1-4 block 1: fallback-agent escalation fires for daemon terminal failures
// via the same Finalizer branch the HTTP path uses (dispatch.ts fallback rules).
describe('POST /api/daemon/steps — fallback escalation (G1-4)', () => {
  test('exhausted retries with a fallback agent reassign the step instead of dead-lettering', async () => {
    mockStepFindUnique.mockResolvedValue({
      ...LEASED_STEP,
      attempts: 2, // next attempt = 3 = maxRetries+1 → terminal
      fallbackAgentId: 'agent-fb',
    })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: false }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockDeadLetterCreate).not.toHaveBeenCalled()
    expect(mockNotificationCreate).not.toHaveBeenCalled()
    const reassignment = mockStepUpdate.mock.calls.find(
      (c: any[]) => c[0].data.agentId === 'agent-fb',
    )
    expect(reassignment).toBeDefined()
    expect(reassignment[0].data.status).toBe('active')
    expect(reassignment[0].data.attempts).toBe(0)
    expect(reassignment[0].data.leasedBy).toBeNull()
  })

  test('exhausted retries with fallback === current agent still dead-letter (no self-fallback loop)', async () => {
    mockStepFindUnique.mockResolvedValue({
      ...LEASED_STEP,
      attempts: 2,
      fallbackAgentId: 'agent-1', // same as step.agentId
    })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom' }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockDeadLetterCreate).toHaveBeenCalledTimes(1)
  })
})

// G1-4 block 1: after a fallback escalation resets step.attempts, the failed
// agent's terminal StepExecution rows occupy the low attempt numbers — the
// completion path must allocate PAST them, never resurrect one.
describe('POST /api/daemon/steps — execution-row allocation (G1-4)', () => {
  test('a terminal latest row is never reused: a fresh row past it is allocated', async () => {
    // Post-fallback state: attempts reset to 0, but attempt-3 row (failed) survives.
    mockExecFindFirst.mockResolvedValue({ id: 'exec-old', attempt: 3, status: 'failed' })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done' }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockExecCreate).toHaveBeenCalledTimes(1)
    expect(mockExecCreate.mock.calls[0][0].data.attempt).toBe(4)
    // The finalized row is the new one, not the resurrected terminal row.
    expect(mockExecUpdate.mock.calls[0][0].where.id).toBe('exec-1')
  })

  test('a still-running latest row is reused (the row created at poll time)', async () => {
    mockExecFindFirst.mockResolvedValue({ id: 'exec-run', attempt: 2, status: 'running' })
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done' }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockExecCreate).not.toHaveBeenCalled()
    expect(mockExecUpdate.mock.calls[0][0].where.id).toBe('exec-run')
  })
})

describe('POST /api/daemon/steps — evidence artifacts (A-3)', () => {
  const gitArtifact = {
    type: 'diff',
    label: 'git diff --stat',
    content: ' app.ts | 2 +-\n 1 file changed',
    metadata: { dirtyFiles: 2, truncated: false },
  }

  test('complete persists validated artifacts with stringified metadata', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', artifacts: [gitArtifact] }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockArtifactCreate).toHaveBeenCalledTimes(1)
    const data = mockArtifactCreate.mock.calls[0][0].data
    expect(data.stepId).toBe('step-1')
    expect(data.type).toBe('diff')
    expect(data.label).toBe('git diff --stat')
    expect(data.content).toContain('1 file changed')
    expect(JSON.parse(data.metadata)).toEqual({ dirtyFiles: 2, truncated: false })
  })

  test('fail also persists artifacts — git evidence of a failed run', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'fail', error: 'boom', willRetry: false, artifacts: [gitArtifact] }),
      params,
    )
    expect(res.status).toBe(200)
    expect(mockArtifactCreate).toHaveBeenCalledTimes(1)
  })

  test('an invalid artifact type → 400 and nothing is written', async () => {
    const res = await POST(
      makeRequest({
        stepId: 'step-1',
        action: 'complete',
        output: 'done',
        artifacts: [{ type: 'not-a-type', label: 'x' }],
      }),
      params,
    )
    expect(res.status).toBe(400)
    expect(mockArtifactCreate).not.toHaveBeenCalled()
    expect(mockStepUpdate).not.toHaveBeenCalled()
  })

  test('artifacts that is not an array → 400', async () => {
    const res = await POST(
      makeRequest({ stepId: 'step-1', action: 'complete', output: 'done', artifacts: 'nope' }),
      params,
    )
    expect(res.status).toBe(400)
    expect(mockStepUpdate).not.toHaveBeenCalled()
  })

  test('more than 10 artifacts → 400 (flood guard)', async () => {
    const res = await POST(
      makeRequest({
        stepId: 'step-1',
        action: 'complete',
        output: 'done',
        artifacts: Array.from({ length: 11 }, () => gitArtifact),
      }),
      params,
    )
    expect(res.status).toBe(400)
    expect(mockArtifactCreate).not.toHaveBeenCalled()
  })

  test('a report without artifacts still completes (backward compatible)', async () => {
    const res = await POST(makeRequest({ stepId: 'step-1', action: 'complete', output: 'done' }), params)
    expect(res.status).toBe(200)
    expect(mockArtifactCreate).not.toHaveBeenCalled()
  })
})
