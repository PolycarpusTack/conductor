import { describe, test, expect, beforeEach } from 'bun:test'

import {
  GLOBAL_MAX_ATTEMPTS,
  MAX_LOGIN_ATTEMPTS,
  clearLoginRateLimit,
  isLoginRateLimited,
  resetLoginRateLimit,
} from '../login-rate-limit'

beforeEach(() => resetLoginRateLimit())

describe('login rate limiter (G-3)', () => {
  test('a single identity bucket trips at the strict cap', () => {
    // First MAX_LOGIN_ATTEMPTS calls are allowed; the next one is limited.
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      expect(isLoginRateLimited('email:victim@x')).toBe(false)
    }
    expect(isLoginRateLimited('email:victim@x')).toBe(true)
  })

  test('the shared global bucket is far more forgiving than a strict bucket', () => {
    // The old behaviour locked the global bucket after MAX_LOGIN_ATTEMPTS (10),
    // which locked out EVERY user. The forgiving cap must survive well past that.
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 5; i++) {
      expect(isLoginRateLimited('global', GLOBAL_MAX_ATTEMPTS)).toBe(false)
    }
    // Sanity: the forgiving cap really is an order of magnitude larger.
    expect(GLOBAL_MAX_ATTEMPTS).toBeGreaterThanOrEqual(MAX_LOGIN_ATTEMPTS * 5)
  })

  test('the global backstop still trips once its (higher) cap is exceeded', () => {
    for (let i = 0; i < GLOBAL_MAX_ATTEMPTS; i++) {
      expect(isLoginRateLimited('global', GLOBAL_MAX_ATTEMPTS)).toBe(false)
    }
    expect(isLoginRateLimited('global', GLOBAL_MAX_ATTEMPTS)).toBe(true)
  })

  test('DoS scenario: an attacker flooding the global bucket does NOT lock a real login', () => {
    // Attacker sends MAX_LOGIN_ATTEMPTS+5 failed requests; each falls in the
    // shared 'global' bucket (TRUSTED_PROXY unset) at the forgiving cap.
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS + 5; i++) {
      expect(isLoginRateLimited('global', GLOBAL_MAX_ATTEMPTS)).toBe(false)
    }
    // A legitimate user's login still passes the global gate (would have been
    // 429'd under the old strict-global behaviour).
    expect(isLoginRateLimited('global', GLOBAL_MAX_ATTEMPTS)).toBe(false)
    // ...and that account has its own fresh strict bucket.
    expect(isLoginRateLimited('email:legit@x')).toBe(false)
  })

  test('per-account brute force is still bounded even while the global bucket is open', () => {
    // A specific email is capped strictly regardless of the forgiving global cap.
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      isLoginRateLimited('email:target@x')
    }
    expect(isLoginRateLimited('email:target@x')).toBe(true)
  })

  test('clearing a bucket (successful login) resets its count', () => {
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) isLoginRateLimited('email:u@x')
    expect(isLoginRateLimited('email:u@x')).toBe(true)
    clearLoginRateLimit('email:u@x')
    expect(isLoginRateLimited('email:u@x')).toBe(false)
  })
})
