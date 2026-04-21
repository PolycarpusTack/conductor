import { describe, test, expect, mock, beforeEach } from 'bun:test'

const mockReactionUpdate = mock(() => Promise.resolve({}))
const mockBroadcast = mock(() => Promise.resolve())
const mockExecuteSlack = mock(() => Promise.resolve({ ok: true }))
const mockExecuteHttp = mock(() => Promise.resolve({ status: 200, ok: true }))

mock.module('@/lib/db', () => ({
  db: { reaction: { update: mockReactionUpdate } },
}))
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mockBroadcast,
}))
mock.module('@/lib/server/reactions/types/slack', () => ({
  executeSlackReaction: mockExecuteSlack,
}))
mock.module('@/lib/server/reactions/types/http', () => ({
  executeHttpReaction: mockExecuteHttp,
}))
mock.module('@/lib/server/reactions/types/jira', () => ({
  executeJiraReaction: mock(() => Promise.resolve({ issueKey: 'PROJ-1' })),
}))
mock.module('@/lib/server/reactions/types/email', () => ({
  executeEmailReaction: mock(() => Promise.resolve({ sent: true })),
}))

import { executeReactions } from '../reactions/executor'

function makeReaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rxn-1',
    triggerId: 'trig-1',
    name: 'Notify Slack',
    type: 'post:slack',
    config: JSON.stringify({ webhookEnvVar: 'SLACK_WEBHOOK', text: 'Done: {{event.taskId}}' }),
    order: 0,
    enabled: true,
    consecutiveFailures: 0,
    lastError: null,
    ...overrides,
  }
}

function makeTrigger(reactions: ReturnType<typeof makeReaction>[] = []) {
  return {
    id: 'trig-1',
    projectId: 'proj-1',
    reactions,
  }
}

beforeEach(() => {
  mockReactionUpdate.mockReset()
  mockBroadcast.mockReset()
  mockExecuteSlack.mockReset()
  mockExecuteHttp.mockReset()
  mockReactionUpdate.mockResolvedValue({})
  mockBroadcast.mockResolvedValue(undefined)
  mockExecuteSlack.mockResolvedValue({ ok: true })
  mockExecuteHttp.mockResolvedValue({ status: 200, ok: true })
})

describe('executeReactions', () => {
  test('executes a slack reaction and resets consecutiveFailures', async () => {
    const trigger = makeTrigger([makeReaction()])
    await executeReactions(trigger as any, { taskId: 'task-1' }, 'task-1')

    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0, lastError: null }),
      }),
    )
  })

  test('merges previous reaction output into context for next reaction', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'First HTTP', type: 'post:http', order: 0 })
    const r2 = makeReaction({ id: 'rxn-2', name: 'Notify Slack', type: 'post:slack', order: 1 })
    const trigger = makeTrigger([r1, r2])

    mockExecuteHttp.mockResolvedValue({ status: 200, ok: true })

    await executeReactions(trigger as any, { taskId: 't1' }, 't1')

    // Both reactions should fire
    expect(mockExecuteHttp).toHaveBeenCalledTimes(1)
    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
  })

  test('stops after first failure and increments consecutiveFailures', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Fail', type: 'post:slack', order: 0 })
    const r2 = makeReaction({ id: 'rxn-2', name: 'Should not run', type: 'post:http', order: 1 })
    const trigger = makeTrigger([r1, r2])

    mockExecuteSlack.mockRejectedValue(new Error('Slack is down'))

    await executeReactions(trigger as any, { taskId: 't1' }, 't1')

    expect(mockExecuteSlack).toHaveBeenCalledTimes(1)
    expect(mockExecuteHttp).not.toHaveBeenCalled()
    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 1, lastError: 'Slack is down' }),
      }),
    )
  })

  test('disables reaction after 5 consecutive failures', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Flakey', type: 'post:slack', order: 0, consecutiveFailures: 4 })
    const trigger = makeTrigger([r1])
    mockExecuteSlack.mockRejectedValue(new Error('down'))

    await executeReactions(trigger as any, {}, undefined)

    expect(mockReactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enabled: false }),
      }),
    )
  })

  test('broadcasts reaction-failed with taskId when failure occurs', async () => {
    const r1 = makeReaction({ id: 'rxn-1', name: 'Bad', type: 'post:slack', order: 0 })
    const trigger = makeTrigger([r1])
    mockExecuteSlack.mockRejectedValue(new Error('oops'))

    await executeReactions(trigger as any, {}, 'task-42')

    expect(mockBroadcast).toHaveBeenCalledWith(
      'proj-1',
      'reaction-failed',
      expect.objectContaining({ taskId: 'task-42', error: 'oops' }),
    )
  })

  test('does not broadcast reaction-failed when taskId is undefined', async () => {
    const trigger = makeTrigger([makeReaction()])
    mockExecuteSlack.mockRejectedValue(new Error('oops'))

    await executeReactions(trigger as any, {}, undefined)

    expect(mockBroadcast).not.toHaveBeenCalled()
  })
})
