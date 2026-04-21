import { describe, test, expect } from 'bun:test'
import {
  createTriggerSchema,
  updateTriggerSchema,
  createReactionSchema,
  updateReactionSchema,
} from '../contracts'

describe('createTriggerSchema', () => {
  test('accepts valid event trigger', () => {
    const result = createTriggerSchema.safeParse({
      name: 'Chain done',
      type: 'event',
      eventType: 'chain-completed',
      eventFilters: [{ field: 'taskId', operator: 'equals', value: 'abc' }],
    })
    expect(result.success).toBe(true)
  })

  test('accepts valid sentry poll trigger', () => {
    const result = createTriggerSchema.safeParse({
      name: 'Sentry prod',
      type: 'poll:sentry',
      pollConfig: { apiTokenEnvVar: 'SENTRY_TOKEN', orgSlug: 'acme', projectSlug: 'backend' },
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = createTriggerSchema.safeParse({ name: 'x', type: 'webhook' })
    expect(result.success).toBe(false)
  })
})

describe('createReactionSchema', () => {
  test('accepts valid slack reaction', () => {
    const result = createReactionSchema.safeParse({
      name: 'Notify Slack',
      type: 'post:slack',
      config: { webhookEnvVar: 'SLACK_WEBHOOK', text: 'Done: {{event.taskId}}' },
      order: 0,
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = createReactionSchema.safeParse({ name: 'x', type: 'post:teams', config: {}, order: 0 })
    expect(result.success).toBe(false)
  })
})
