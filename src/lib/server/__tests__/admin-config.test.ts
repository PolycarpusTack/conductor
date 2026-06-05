import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockConfigFindUnique = mock(() => Promise.resolve(null)) as any
const mockConfigUpsert = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    adminConfig: { findUnique: mockConfigFindUnique, upsert: mockConfigUpsert },
  },
  isPostgresDb: false,
}))

import {
  scryptHash,
  scryptVerify,
  getAdminConfig,
  setAdminPassword,
  invalidateAdminConfigCache,
} from '../admin-config'

beforeEach(() => {
  invalidateAdminConfigCache()
  mockConfigFindUnique.mockReset()
  mockConfigFindUnique.mockResolvedValue(null)
  mockConfigUpsert.mockReset()
  mockConfigUpsert.mockResolvedValue({})
})

describe('scrypt password hashing', () => {
  test('roundtrip verifies the original password', () => {
    const stored = scryptHash('correct horse battery staple')
    expect(scryptVerify('correct horse battery staple', stored)).toBe(true)
  })

  test('rejects a wrong password', () => {
    const stored = scryptHash('correct horse battery staple')
    expect(scryptVerify('Tr0ub4dor&3', stored)).toBe(false)
  })

  test('two hashes of the same password differ (random salt)', () => {
    expect(scryptHash('same')).not.toBe(scryptHash('same'))
  })

  test('rejects malformed stored values', () => {
    expect(scryptVerify('x', 'not-a-hash')).toBe(false)
  })
})

describe('getAdminConfig', () => {
  test('returns defaults when no row exists', async () => {
    const config = await getAdminConfig()
    expect(config).toEqual({ passwordHash: null, sessionTtlHours: 12 })
  })

  test('caches reads until invalidated', async () => {
    mockConfigFindUnique.mockResolvedValue({ passwordHash: 'a:b', sessionTtlHours: 24 })
    await getAdminConfig()
    await getAdminConfig()
    expect(mockConfigFindUnique).toHaveBeenCalledTimes(1)

    invalidateAdminConfigCache()
    await getAdminConfig()
    expect(mockConfigFindUnique).toHaveBeenCalledTimes(2)
  })

  test('falls back to defaults on DB failure', async () => {
    mockConfigFindUnique.mockRejectedValueOnce(new Error('db down'))
    const config = await getAdminConfig()
    expect(config.passwordHash).toBeNull()
  })
})

describe('setAdminPassword', () => {
  test('persists a scrypt hash and invalidates the cache', async () => {
    await setAdminPassword('new-password-123')
    const call = mockConfigUpsert.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'singleton' })
    expect(scryptVerify('new-password-123', call.create.passwordHash)).toBe(true)
  })
})
