import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock @/lib/db before importing the module under test
// ---------------------------------------------------------------------------

const mockEventCreate = mock(() => Promise.resolve({ id: 'evt-1' })) as any
const mockDeadLetterCreate = mock(() => Promise.resolve({ id: 'dl-1' })) as any

mock.module('@/lib/db', () => ({
  db: {
    stepEvent: { create: mockEventCreate },
    deadLetterStep: { create: mockDeadLetterCreate },
  },
}))

// Import AFTER mocking
import { appendStepEvent, computeBackoffMs, moveToDeadLetter } from '../step-events'

beforeEach(() => {
  mockEventCreate.mockReset()
  mockEventCreate.mockImplementation(() => Promise.resolve({ id: 'evt-1' }))
  mockDeadLetterCreate.mockReset()
  mockDeadLetterCreate.mockImplementation(() => Promise.resolve({ id: 'dl-1' }))
})

describe('appendStepEvent', () => {
  test('creates a step event with the correct shape', async () => {
    await appendStepEvent('step-1', 'leased', { worker: 'w1' })
    expect(mockEventCreate).toHaveBeenCalledTimes(1)
    const call = mockEventCreate.mock.calls[0][0]
    expect(call.data.stepId).toBe('step-1')
    expect(call.data.event).toBe('leased')
    expect(JSON.parse(call.data.data)).toEqual({ worker: 'w1' })
  })

  test('accepts null data', async () => {
    await appendStepEvent('step-2', 'succeeded', null)
    const call = mockEventCreate.mock.calls[0][0]
    expect(call.data.data).toBeNull()
  })

  test('never throws when the write fails', async () => {
    mockEventCreate.mockRejectedValueOnce(new Error('db down'))
    await expect(appendStepEvent('step-3', 'failed', { error: 'x' })).resolves.toBeUndefined()
  })
})

describe('computeBackoffMs', () => {
  test('attempt 1 stays within [baseMs, 2*baseMs)', () => {
    for (let i = 0; i < 50; i++) {
      const ms = computeBackoffMs(1, 5000)
      expect(ms).toBeGreaterThanOrEqual(5000)
      expect(ms).toBeLessThan(10000)
    }
  })

  test('caps at 3600000ms (1 hour) for large attempts', () => {
    for (let i = 0; i < 50; i++) {
      expect(computeBackoffMs(20, 5000)).toBeLessThanOrEqual(3_600_000)
    }
  })

  test('grows exponentially: attempt 3 floor is 4x attempt 1 floor', () => {
    const min = (attempt: number) =>
      Math.min(...Array.from({ length: 30 }, () => computeBackoffMs(attempt, 5000)))
    expect(min(3)).toBeGreaterThanOrEqual(20_000) // 5000 * 2^2
    expect(min(1)).toBeGreaterThanOrEqual(5_000)
  })

  test('clamps attempt below 1 to 1', () => {
    const ms = computeBackoffMs(0, 5000)
    expect(ms).toBeGreaterThanOrEqual(5000)
    expect(ms).toBeLessThan(10000)
  })

  test('zero base delay returns zero', () => {
    expect(computeBackoffMs(3, 0)).toBe(0)
  })
})

describe('moveToDeadLetter', () => {
  test('creates a dead letter entry and appends a dead_lettered event', async () => {
    await moveToDeadLetter(
      {
        id: 'step-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        mode: 'develop',
        instructions: 'do x',
        attempts: 5,
      },
      'Timeout after 5 attempts',
    )

    expect(mockDeadLetterCreate).toHaveBeenCalledTimes(1)
    const dlCall = mockDeadLetterCreate.mock.calls[0][0]
    expect(dlCall.data.originalStepId).toBe('step-1')
    expect(dlCall.data.taskId).toBe('task-1')
    expect(dlCall.data.attempts).toBe(5)
    expect(dlCall.data.lastError).toBe('Timeout after 5 attempts')
    expect(JSON.parse(dlCall.data.payload).mode).toBe('develop')

    expect(mockEventCreate).toHaveBeenCalledTimes(1)
    const evtCall = mockEventCreate.mock.calls[0][0]
    expect(evtCall.data.stepId).toBe('step-1')
    expect(evtCall.data.event).toBe('dead_lettered')
  })

  test('normalizes missing agentId and instructions to null', async () => {
    await moveToDeadLetter(
      { id: 'step-2', taskId: 'task-1', mode: 'develop', attempts: 3 },
      'boom',
    )
    const dlCall = mockDeadLetterCreate.mock.calls[0][0]
    expect(dlCall.data.agentId).toBeNull()
    expect(dlCall.data.instructions).toBeNull()
  })
})
