import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockStepFindUnique = mock(() => Promise.resolve(null)) as any
const mockExecutionFindMany = mock(() => Promise.resolve([])) as any
const mockArtifactFindMany = mock(() => Promise.resolve([])) as any
const mockEventFindMany = mock(() => Promise.resolve([])) as any
const mockSessionFindMany = mock(() => Promise.resolve([])) as any
const mockMessageFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: { findUnique: mockStepFindUnique },
    stepExecution: { findMany: mockExecutionFindMany },
    stepArtifact: { findMany: mockArtifactFindMany },
    stepEvent: { findMany: mockEventFindMany },
    agentSession: { findMany: mockSessionFindMany },
    agentMessage: { findMany: mockMessageFindMany },
  },
  isPostgresDb: false,
}))

import { assembleStepEvidence } from '../evidence'

beforeEach(() => {
  mockStepFindUnique.mockReset()
  mockStepFindUnique.mockResolvedValue({ taskId: 'task-1' })
  mockExecutionFindMany.mockReset()
  mockExecutionFindMany.mockResolvedValue([])
  mockArtifactFindMany.mockReset()
  mockArtifactFindMany.mockResolvedValue([])
  mockEventFindMany.mockReset()
  mockEventFindMany.mockResolvedValue([])
  mockSessionFindMany.mockReset()
  mockSessionFindMany.mockResolvedValue([])
  mockMessageFindMany.mockReset()
  mockMessageFindMany.mockResolvedValue([])
})

describe('assembleStepEvidence', () => {
  test('returns null when the step belongs to another task', async () => {
    mockStepFindUnique.mockResolvedValue({ taskId: 'task-OTHER' })
    expect(await assembleStepEvidence('task-1', 'step-1')).toBeNull()
  })

  test('returns null for an unknown step', async () => {
    mockStepFindUnique.mockResolvedValue(null)
    expect(await assembleStepEvidence('task-1', 'step-1')).toBeNull()
  })

  test('parses execution evidence and tool calls', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        id: 'exec-1',
        attempt: 1,
        status: 'succeeded',
        tokensUsed: 1200,
        cost: 0.01,
        durationMs: 4200,
        evidence: JSON.stringify({ memoryHits: [{ id: 'm1', category: 'fact' }], workingMemory: true }),
        toolCalls: [
          { toolName: 'srv__search', durationMs: 300, error: null, createdAt: new Date() },
        ],
      },
    ])
    const packet = await assembleStepEvidence('task-1', 'step-1')
    expect(packet?.executions).toHaveLength(1)
    expect(packet?.executions[0].memoryHits).toEqual([{ id: 'm1', category: 'fact' }])
    expect(packet?.executions[0].workingMemory).toBe(true)
    expect(packet?.executions[0].toolCalls[0].toolName).toBe('srv__search')
  })

  test('collects session ids from rows AND step event data', async () => {
    mockSessionFindMany.mockResolvedValue([
      { id: 'sess-row', sessionKey: 'k', backend: 'pty', status: 'exited', hostId: 'h1', exitCode: 0 },
    ])
    mockEventFindMany.mockResolvedValue([
      {
        id: 'evt-1',
        event: 'succeeded',
        data: JSON.stringify({ source: 'daemon', sessionId: 'sess-from-event' }),
        createdAt: new Date(),
      },
    ])
    const packet = await assembleStepEvidence('task-1', 'step-1')
    expect(packet?.sessionIds.sort()).toEqual(['sess-from-event', 'sess-row'])
  })

  test('aggregates safety flags from message security verdicts', async () => {
    mockMessageFindMany.mockResolvedValue([
      {
        id: 'msg-1',
        fromAddress: 'researcher',
        toAddress: 'reviewer',
        subject: null,
        status: 'read',
        bodySecurity: JSON.stringify({
          trust: 'agent',
          flags: [{ category: 'instruction-override', pattern: 'x', match: 'y' }],
        }),
      },
      {
        id: 'msg-2',
        fromAddress: 'admin@conductor',
        toAddress: 'reviewer',
        subject: 'hi',
        status: 'queued',
        bodySecurity: '{"trust":"admin","flags":[]}',
      },
    ])
    const packet = await assembleStepEvidence('task-1', 'step-1')
    expect(packet?.messages).toHaveLength(2)
    expect(packet?.messages[0].flagged).toBe(true)
    expect(packet?.messages[1].flagged).toBe(false)
    expect(packet?.safetyFlags).toEqual([
      { source: 'message:researcher', category: 'instruction-override' },
    ])
  })

  test('handles executions with no evidence column gracefully', async () => {
    mockExecutionFindMany.mockResolvedValue([
      {
        id: 'exec-1',
        attempt: 1,
        status: 'failed',
        tokensUsed: null,
        cost: null,
        durationMs: null,
        evidence: null,
        toolCalls: [],
      },
    ])
    const packet = await assembleStepEvidence('task-1', 'step-1')
    expect(packet?.executions[0].memoryHits).toEqual([])
    expect(packet?.executions[0].workingMemory).toBe(false)
  })
})
