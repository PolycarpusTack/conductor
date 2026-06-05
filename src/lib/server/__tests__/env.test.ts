import { describe, test, expect } from 'bun:test'
import { validateEnv } from '@/lib/env'

describe('validateEnv', () => {
  test('passes for a minimal development env', () => {
    const env = validateEnv({ NODE_ENV: 'development' })
    expect(env.NODE_ENV).toBe('development')
  })

  test('defaults NODE_ENV to development', () => {
    const env = validateEnv({})
    expect(env.NODE_ENV).toBe('development')
  })

  test('throws in production when admin password is missing', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /AGENTBOARD_ADMIN_PASSWORD is required in production/,
    )
  })

  test('passes in production with a valid admin password', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      AGENTBOARD_ADMIN_PASSWORD: 'long-enough-password',
    })
    expect(env.AGENTBOARD_ADMIN_PASSWORD).toBe('long-enough-password')
  })

  test('falls back to legacy ADMIN_PASSWORD', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'long-enough-password',
    })
    expect(env.AGENTBOARD_ADMIN_PASSWORD).toBe('long-enough-password')
  })

  test('throws for a too-short admin password', () => {
    expect(() =>
      validateEnv({ AGENTBOARD_ADMIN_PASSWORD: 'short' }),
    ).toThrow(/at least 8 characters/)
  })

  test('throws for a too-short session secret', () => {
    expect(() =>
      validateEnv({ AGENTBOARD_ADMIN_SESSION_SECRET: 'short' }),
    ).toThrow(/at least 16 characters/)
  })

  test('throws for a too-short websocket secret', () => {
    expect(() =>
      validateEnv({ AGENTBOARD_WS_SECRET: 'short' }),
    ).toThrow(/at least 16 characters/)
  })
})
