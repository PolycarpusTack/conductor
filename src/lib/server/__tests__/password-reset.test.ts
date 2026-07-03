import { describe, test, expect, mock, beforeEach } from 'bun:test'

// bun's mock.module registry is shared across a run — expose the full db
// surface the service touches so no other test file crashes on a missing name.
const mockResetCreate = mock((args: any) => Promise.resolve({ id: 'rt-1', ...args.data })) as any
const mockResetFindUnique = mock(() => Promise.resolve(null)) as any
const mockResetUpdate = mock((args: any) => Promise.resolve({ id: 'rt-1', ...args.data })) as any
const mockUserUpdate = mock((args: any) => Promise.resolve({ id: 'u-1', ...args.data })) as any
const mockSessionDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any

mock.module('@/lib/db', () => ({
  db: {
    passwordResetToken: {
      create: mockResetCreate,
      findUnique: mockResetFindUnique,
      update: mockResetUpdate,
    },
    user: { update: mockUserUpdate },
    userSession: { deleteMany: mockSessionDeleteMany },
  },
  isPostgresDb: false,
}))

// The real scrypt helpers are pure (only getAdminConfig touches the db, which
// the service never calls) — import them directly to assert a real hash shape.
import { scryptVerify } from '../admin-config'

import {
  issueResetToken,
  consumeResetToken,
  ResetTokenError,
  RESET_TOKEN_PREFIX,
} from '../password-reset'

beforeEach(() => {
  for (const m of [
    mockResetCreate, mockResetFindUnique, mockResetUpdate, mockUserUpdate, mockSessionDeleteMany,
  ]) m.mockReset()
  mockResetCreate.mockImplementation((args: any) => Promise.resolve({ id: 'rt-1', ...args.data }))
  mockResetFindUnique.mockResolvedValue(null)
  mockResetUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'rt-1', ...args.data }))
  mockUserUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'u-1', ...args.data }))
  mockSessionDeleteMany.mockResolvedValue({ count: 0 })
  delete process.env.AGENTBOARD_RESET_TOKEN_TTL_MS
})

const SHA256_HEX = /^[0-9a-f]{64}$/

describe('issueResetToken', () => {
  test('returns a prefixed raw token and stores ONLY the hash + expiry', async () => {
    const token = await issueResetToken('u-1')
    expect(token.startsWith(RESET_TOKEN_PREFIX)).toBe(true)

    const stored = mockResetCreate.mock.calls[0][0].data
    expect(stored.userId).toBe('u-1')
    // never the raw token
    expect(stored.tokenHash).not.toContain(token)
    expect(stored.tokenHash).toMatch(SHA256_HEX)
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('honors AGENTBOARD_RESET_TOKEN_TTL_MS', async () => {
    process.env.AGENTBOARD_RESET_TOKEN_TTL_MS = '1000'
    await issueResetToken('u-1')
    const { expiresAt } = mockResetCreate.mock.calls[0][0].data
    // ~1s from now, well under the 1h default
    expect(expiresAt.getTime() - Date.now()).toBeLessThan(10_000)
  })
})

describe('consumeResetToken', () => {
  function validRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rt-1',
      userId: 'u-1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      ...overrides,
    }
  }

  test('valid token sets the password, marks used, and revokes sessions', async () => {
    mockResetFindUnique.mockResolvedValue(validRow())
    const token = await issueResetToken('u-1') // real token/hash round-trip

    const result = await consumeResetToken(token, 'brand-new-pass')
    expect(result).toEqual({ userId: 'u-1' })

    // looked up by the hash of the raw token, never the raw token itself
    const lookupHash = mockResetFindUnique.mock.calls[0][0].where.tokenHash
    expect(lookupHash).toMatch(SHA256_HEX)
    expect(lookupHash).not.toContain(token)

    // password set with a real scrypt hash that verifies
    const newHash = mockUserUpdate.mock.calls[0][0].data.passwordHash
    expect(newHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(scryptVerify('brand-new-pass', newHash)).toBe(true)

    // token marked used
    expect(mockResetUpdate.mock.calls[0][0].data.usedAt).toBeInstanceOf(Date)
    // sessions revoked
    expect(mockSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } })
  })

  test('rejects an expired token (no password change)', async () => {
    mockResetFindUnique.mockResolvedValue(validRow({ expiresAt: new Date(Date.now() - 1000) }))
    await expect(consumeResetToken(`${RESET_TOKEN_PREFIX}abc`, 'x')).rejects.toMatchObject({ code: 'expired' })
    expect(mockUserUpdate).not.toHaveBeenCalled()
    expect(mockSessionDeleteMany).not.toHaveBeenCalled()
  })

  test('rejects an already-used token', async () => {
    mockResetFindUnique.mockResolvedValue(validRow({ usedAt: new Date(Date.now() - 5000) }))
    await expect(consumeResetToken(`${RESET_TOKEN_PREFIX}abc`, 'x')).rejects.toMatchObject({ code: 'used' })
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  test('rejects an unknown token', async () => {
    mockResetFindUnique.mockResolvedValue(null)
    await expect(consumeResetToken(`${RESET_TOKEN_PREFIX}nope`, 'x')).rejects.toMatchObject({ code: 'invalid_token' })
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  test('rejects a wrong-prefix / garbage token WITHOUT hitting the database', async () => {
    await expect(consumeResetToken('not-a-reset-token', 'x')).rejects.toBeInstanceOf(ResetTokenError)
    expect(mockResetFindUnique).not.toHaveBeenCalled()
  })
})
