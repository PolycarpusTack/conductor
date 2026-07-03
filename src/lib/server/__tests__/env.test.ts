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
      AGENTBOARD_WS_SECRET: 'a-ws-secret-16-chars-long',
      AGENTBOARD_WS_INTERNAL_SECRET: 'an-internal-secret-16-chars',
    })
    expect(env.AGENTBOARD_ADMIN_PASSWORD).toBe('long-enough-password')
  })

  test('falls back to legacy ADMIN_PASSWORD', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      ADMIN_PASSWORD: 'long-enough-password',
      AGENTBOARD_WS_SECRET: 'a-ws-secret-16-chars-long',
      AGENTBOARD_WS_INTERNAL_SECRET: 'an-internal-secret-16-chars',
    })
    expect(env.AGENTBOARD_ADMIN_PASSWORD).toBe('long-enough-password')
  })

  test('throws in production when AGENTBOARD_WS_SECRET is missing', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        AGENTBOARD_ADMIN_PASSWORD: 'long-enough-password',
        AGENTBOARD_WS_INTERNAL_SECRET: 'an-internal-secret-16-chars',
      }),
    ).toThrow(/AGENTBOARD_WS_SECRET is required in production/)
  })

  test('throws in production when AGENTBOARD_WS_INTERNAL_SECRET is missing', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        AGENTBOARD_ADMIN_PASSWORD: 'long-enough-password',
        AGENTBOARD_WS_SECRET: 'a-ws-secret-16-chars-long',
      }),
    ).toThrow(/AGENTBOARD_WS_INTERNAL_SECRET is required in production/)
  })

  test('reports both missing WS secrets at once in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        AGENTBOARD_ADMIN_PASSWORD: 'long-enough-password',
      }),
    ).toThrow(/AGENTBOARD_WS_SECRET is required in production[\s\S]*AGENTBOARD_WS_INTERNAL_SECRET is required in production/)
  })

  test('WS secrets stay optional in development', () => {
    const env = validateEnv({ NODE_ENV: 'development' })
    expect(env.AGENTBOARD_WS_SECRET).toBeUndefined()
    expect(env.AGENTBOARD_WS_INTERNAL_SECRET).toBeUndefined()
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
