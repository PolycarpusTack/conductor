import { describe, test, expect } from 'bun:test'
import {
  appendOutputPreview,
  redactSecrets,
  applySessionEvent,
  MAX_OUTPUT_PREVIEW_CHARS,
} from '../agent-sessions'

describe('appendOutputPreview', () => {
  test('appends to existing preview', () => {
    expect(appendOutputPreview('hello ', 'world')).toBe('hello world')
  })

  test('keeps only the last MAX_OUTPUT_PREVIEW_CHARS', () => {
    const existing = 'x'.repeat(MAX_OUTPUT_PREVIEW_CHARS)
    const result = appendOutputPreview(existing, 'TAIL')
    expect(result.length).toBe(MAX_OUTPUT_PREVIEW_CHARS)
    expect(result.endsWith('TAIL')).toBe(true)
  })

  test('handles null existing preview', () => {
    expect(appendOutputPreview(null, 'first')).toBe('first')
  })
})

describe('redactSecrets', () => {
  test('masks bearer tokens', () => {
    const out = redactSecrets('Authorization: Bearer abc123secret456')
    expect(out).not.toContain('abc123secret456')
    expect(out).toContain('[REDACTED]')
  })

  test('masks structured app keys (cd_daemon / ab_agent / ab_project)', () => {
    const out = redactSecrets('token cd_daemon.abc.deadbeef0123 and ab_agent.x.cafebabe4567')
    expect(out).not.toContain('deadbeef0123')
    expect(out).not.toContain('cafebabe4567')
  })

  test('masks sk-style API keys', () => {
    const out = redactSecrets('OPENAI says sk-proj-AbCdEf1234567890TUVxyz')
    expect(out).not.toContain('sk-proj-AbCdEf1234567890TUVxyz')
  })

  test('masks KEY=value pairs for secret-looking names', () => {
    const out = redactSecrets('export AGENTBOARD_WS_SECRET=supersecret123 DB_PASSWORD=hunter2')
    expect(out).not.toContain('supersecret123')
    expect(out).not.toContain('hunter2')
  })

  test('leaves ordinary output untouched', () => {
    const text = 'Compiled 14 modules in 1.2s\nTests: 12 passed'
    expect(redactSecrets(text)).toBe(text)
  })
})

describe('applySessionEvent', () => {
  const base = {
    status: 'active',
    outputPreview: null as string | null,
    command: null as string | null,
    metadata: null as string | null,
    endedAt: null as Date | null,
    exitCode: null as number | null,
  }

  test('status event updates status', () => {
    const patch = applySessionEvent(base, { type: 'status', status: 'idle' })
    expect(patch.status).toBe('idle')
    expect(patch.lastActivityAt).toBeInstanceOf(Date)
    expect(patch.endedAt).toBeUndefined()
  })

  test('exited status sets endedAt and exitCode', () => {
    const patch = applySessionEvent(base, { type: 'status', status: 'exited', exitCode: 0 })
    expect(patch.status).toBe('exited')
    expect(patch.endedAt).toBeInstanceOf(Date)
    expect(patch.exitCode).toBe(0)
  })

  test('output event appends redacted tail and bumps activity', () => {
    const patch = applySessionEvent(
      { ...base, outputPreview: 'before\n' },
      { type: 'output', stream: 'stdout', chunk: 'token sk-proj-AbCdEf1234567890TUVxyz done' },
    )
    expect(patch.outputPreview).toContain('before')
    expect(patch.outputPreview).not.toContain('sk-proj-AbCdEf1234567890TUVxyz')
    expect(patch.lastActivityAt).toBeInstanceOf(Date)
  })

  test('output events do not resurrect a terminal status', () => {
    const patch = applySessionEvent(
      { ...base, status: 'exited' },
      { type: 'output', stream: 'stdout', chunk: 'late flush' },
    )
    expect(patch.status).toBeUndefined() // status untouched
    expect(patch.outputPreview).toContain('late flush')
  })

  test('command event sets the command summary', () => {
    const patch = applySessionEvent(base, { type: 'command', commandSummary: 'bun test' })
    expect(patch.command).toBe('bun test')
  })

  test('metric event merges into metadata', () => {
    const patch = applySessionEvent(
      { ...base, metadata: JSON.stringify({ pid: 42 }) },
      { type: 'metric', cpuPct: 31, memoryMb: 512 },
    )
    const metadata = JSON.parse(patch.metadata as string)
    expect(metadata.pid).toBe(42)
    expect(metadata.metrics.cpuPct).toBe(31)
  })
})
