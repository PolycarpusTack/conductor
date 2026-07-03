import { describe, expect, it } from 'bun:test'
import { registerDaemonSchema } from '../daemon-contracts'

const base = {
  hostname: 'smoke-host',
  platform: 'win32' as const,
  version: '1.0.0',
}

describe('registerDaemonSchema capabilities (A-4 regression)', () => {
  // z.record over an enum key requires EVERY key in zod v4 — a daemon
  // registering with a single capability (the normal case) got a 400 and
  // registration had never succeeded live before this fix.
  it('accepts a single capability — the reference daemon default', () => {
    const result = registerDaemonSchema.safeParse({
      ...base,
      capabilities: { 'claude-code': { version: '2.1.199' } },
    })
    expect(result.success).toBe(true)
  })

  it('accepts the full capability set', () => {
    const result = registerDaemonSchema.safeParse({
      ...base,
      capabilities: {
        'claude-code': { version: '1' },
        codex: { version: '1' },
        copilot: { version: '1' },
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown capability keys', () => {
    const result = registerDaemonSchema.safeParse({
      ...base,
      capabilities: { 'not-a-cli': { version: '1' } },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a capability missing its version', () => {
    const result = registerDaemonSchema.safeParse({
      ...base,
      capabilities: { 'claude-code': { path: '/usr/bin/claude' } },
    })
    expect(result.success).toBe(false)
  })
})
