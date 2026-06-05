import { describe, test, expect } from 'bun:test'
import {
  parseSessionPolicy,
  sessionKeyForStep,
  resolveCommandTemplate,
  DEFAULT_SESSION_POLICY,
} from '../session-policy'

describe('parseSessionPolicy', () => {
  test('returns defaults for null config', () => {
    const policy = parseSessionPolicy(null)
    expect(policy).toEqual(DEFAULT_SESSION_POLICY)
    expect(policy.sessionPolicy).toBe('ephemeral')
    expect(policy.sessionBackend).toBe('process')
    expect(policy.idleRequiredBeforeCommand).toBe(false)
    expect(policy.maxOutputPreviewChars).toBe(5000)
  })

  test('parses a full config', () => {
    const policy = parseSessionPolicy(
      JSON.stringify({
        sessionPolicy: 'persistent-agent',
        sessionBackend: 'pty',
        commandTemplate: 'codex --model {{agent.runtimeModel}}',
        workingDirectoryPolicy: 'project-root',
        idleRequiredBeforeCommand: true,
        maxOutputPreviewChars: 2000,
      }),
    )
    expect(policy.sessionPolicy).toBe('persistent-agent')
    expect(policy.sessionBackend).toBe('pty')
    expect(policy.commandTemplate).toBe('codex --model {{agent.runtimeModel}}')
    expect(policy.idleRequiredBeforeCommand).toBe(true)
    expect(policy.maxOutputPreviewChars).toBe(2000)
  })

  test('unknown values degrade to defaults instead of throwing', () => {
    const policy = parseSessionPolicy(
      JSON.stringify({ sessionPolicy: 'forever', sessionBackend: 'teletype', maxOutputPreviewChars: -5 }),
    )
    expect(policy.sessionPolicy).toBe('ephemeral')
    expect(policy.sessionBackend).toBe('process')
    expect(policy.maxOutputPreviewChars).toBe(5000)
  })

  test('corrupt JSON degrades to defaults', () => {
    expect(parseSessionPolicy('not-json')).toEqual(DEFAULT_SESSION_POLICY)
  })

  test('ignores unrelated runtime config keys', () => {
    const policy = parseSessionPolicy(JSON.stringify({ temperature: 0.2, sessionBackend: 'tmux' }))
    expect(policy.sessionBackend).toBe('tmux')
    expect(policy.sessionPolicy).toBe('ephemeral')
  })
})

describe('sessionKeyForStep', () => {
  const ids = { agentId: 'agent-1', taskId: 'task-1', stepId: 'step-1' }

  test('ephemeral keys by step', () => {
    expect(sessionKeyForStep({ ...DEFAULT_SESSION_POLICY, sessionPolicy: 'ephemeral' }, ids)).toBe('step-step-1')
  })

  test('persistent-agent keys by agent', () => {
    expect(sessionKeyForStep({ ...DEFAULT_SESSION_POLICY, sessionPolicy: 'persistent-agent' }, ids)).toBe(
      'agent-agent-1',
    )
  })

  test('persistent-task keys by task', () => {
    expect(sessionKeyForStep({ ...DEFAULT_SESSION_POLICY, sessionPolicy: 'persistent-task' }, ids)).toBe(
      'task-task-1',
    )
  })

  test('persistent-step keys by step', () => {
    expect(sessionKeyForStep({ ...DEFAULT_SESSION_POLICY, sessionPolicy: 'persistent-step' }, ids)).toBe(
      'step-step-1',
    )
  })

  test('persistent-agent without agentId falls back to step key', () => {
    expect(
      sessionKeyForStep({ ...DEFAULT_SESSION_POLICY, sessionPolicy: 'persistent-agent' }, { ...ids, agentId: null }),
    ).toBe('step-step-1')
  })
})

describe('resolveCommandTemplate', () => {
  test('substitutes known tokens', () => {
    expect(
      resolveCommandTemplate('codex --model {{agent.runtimeModel}} --task {{task.id}}', {
        'agent.runtimeModel': 'gpt-5',
        'task.id': 'task-1',
      }),
    ).toBe('codex --model gpt-5 --task task-1')
  })

  test('unknown tokens resolve to empty string', () => {
    expect(resolveCommandTemplate('run {{nope}} now', {})).toBe('run  now')
  })

  test('null template returns null', () => {
    expect(resolveCommandTemplate(null, {})).toBeNull()
  })
})
