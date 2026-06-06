import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockUserCount = mock(() => Promise.resolve(0)) as any
const mockUserCreate = mock((args: any) => Promise.resolve({ id: 'u-1', ...args.data })) as any
const mockUserFindUnique = mock(() => Promise.resolve(null)) as any
const mockSessionCreate = mock(() => Promise.resolve({})) as any
const mockSessionFindUnique = mock(() => Promise.resolve(null)) as any
const mockSessionDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any

mock.module('@/lib/db', () => ({
  db: {
    user: { count: mockUserCount, create: mockUserCreate, findUnique: mockUserFindUnique },
    userSession: {
      create: mockSessionCreate,
      findUnique: mockSessionFindUnique,
      deleteMany: mockSessionDeleteMany,
    },
  },
  isPostgresDb: false,
}))

// admin-config's real scrypt helpers are pure — only getAdminConfig touches
// the db, so mock the module but keep real hashing for verify round-trips.
// (The relative import bypasses the alias mock and loads the real module.)
import { scryptHash, scryptVerify } from '../admin-config'
const mockGetAdminConfig = mock(() => Promise.resolve({ passwordHash: null, sessionTtlHours: 12 })) as any
mock.module('@/lib/server/admin-config', () => ({
  getAdminConfig: mockGetAdminConfig,
  invalidateAdminConfigCache: mock(() => undefined),
  setAdminPassword: mock(() => Promise.resolve()),
  setSessionTtlHours: mock(() => Promise.resolve()),
  scryptHash,
  scryptVerify,
}))

import {
  usersExist,
  invalidateUsersCache,
  createUser,
  verifyUserCredentials,
  createUserSession,
  resolveUserSession,
  bootstrapOwnerFromLegacy,
  OWNER_BOOTSTRAP_EMAIL,
} from '../user-auth'

beforeEach(() => {
  for (const m of [
    mockUserCount, mockUserCreate, mockUserFindUnique,
    mockSessionCreate, mockSessionFindUnique, mockSessionDeleteMany, mockGetAdminConfig,
  ]) m.mockReset()
  mockUserCount.mockResolvedValue(0)
  mockUserCreate.mockImplementation((args: any) => Promise.resolve({ id: 'u-1', ...args.data }))
  mockUserFindUnique.mockResolvedValue(null)
  mockSessionCreate.mockResolvedValue({})
  mockSessionFindUnique.mockResolvedValue(null)
  mockSessionDeleteMany.mockResolvedValue({ count: 0 })
  mockGetAdminConfig.mockResolvedValue({ passwordHash: null, sessionTtlHours: 12 })
  invalidateUsersCache()
})

describe('usersExist', () => {
  test('caches the count and invalidates on demand', async () => {
    mockUserCount.mockResolvedValue(0)
    expect(await usersExist()).toBe(false)
    expect(await usersExist()).toBe(false)
    expect(mockUserCount).toHaveBeenCalledTimes(1) // cached

    mockUserCount.mockResolvedValue(2)
    invalidateUsersCache()
    expect(await usersExist()).toBe(true)
    expect(mockUserCount).toHaveBeenCalledTimes(2)
  })
})

describe('createUser / verifyUserCredentials', () => {
  test('hashes the password and lowercases the email', async () => {
    await createUser({ email: 'Dev@Example.COM', name: 'Dev', password: 'hunter22' })
    const data = mockUserCreate.mock.calls[0][0].data
    expect(data.email).toBe('dev@example.com')
    expect(data.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(data.role).toBe('member')
  })

  test('verifies a matching password', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'u-1', email: 'dev@example.com', name: 'Dev', role: 'admin',
      isActive: true, passwordHash: scryptHash('hunter22'),
    })
    const user = await verifyUserCredentials('dev@example.com', 'hunter22')
    expect(user).toMatchObject({ id: 'u-1', role: 'admin' })
  })

  test('rejects a wrong password and an inactive user', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: 'u-1', email: 'dev@example.com', name: 'Dev', role: 'admin',
      isActive: true, passwordHash: scryptHash('hunter22'),
    })
    expect(await verifyUserCredentials('dev@example.com', 'wrong')).toBeNull()

    mockUserFindUnique.mockResolvedValue({
      id: 'u-1', email: 'dev@example.com', name: 'Dev', role: 'admin',
      isActive: false, passwordHash: scryptHash('hunter22'),
    })
    expect(await verifyUserCredentials('dev@example.com', 'hunter22')).toBeNull()
  })
})

describe('user sessions', () => {
  test('round-trips a token through create and resolve', async () => {
    const token = await createUserSession('u-1', 12)
    expect(token.startsWith('cu_')).toBe(true)
    // only the hash is stored
    const stored = mockSessionCreate.mock.calls[0][0].data
    expect(stored.tokenHash).not.toContain(token)
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now())

    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u-1', email: 'dev@example.com', name: 'Dev', role: 'member', isActive: true },
    })
    const user = await resolveUserSession(token)
    expect(user).toMatchObject({ id: 'u-1', role: 'member' })
    expect(mockSessionFindUnique.mock.calls[0][0].where.tokenHash).toBe(stored.tokenHash)
  })

  test('rejects expired sessions and inactive users', async () => {
    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 1000),
      user: { id: 'u-1', email: 'a@b.c', name: 'A', role: 'member', isActive: true },
    })
    expect(await resolveUserSession('cu_deadbeef')).toBeNull()

    mockSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u-1', email: 'a@b.c', name: 'A', role: 'member', isActive: false },
    })
    expect(await resolveUserSession('cu_deadbeef')).toBeNull()
  })

  test('non-prefixed tokens never hit the database', async () => {
    expect(await resolveUserSession('legacy-hmac-token')).toBeNull()
    expect(mockSessionFindUnique).not.toHaveBeenCalled()
  })
})

describe('bootstrapOwnerFromLegacy', () => {
  test('reuses the AdminConfig hash verbatim when present', async () => {
    const existingHash = scryptHash('the-admin-password')
    mockGetAdminConfig.mockResolvedValue({ passwordHash: existingHash, sessionTtlHours: 12 })

    const owner = await bootstrapOwnerFromLegacy('the-admin-password')
    expect(owner.email).toBe(OWNER_BOOTSTRAP_EMAIL)
    expect(mockUserCreate.mock.calls[0][0].data.passwordHash).toBe(existingHash)
    expect(mockUserCreate.mock.calls[0][0].data.role).toBe('owner')
  })

  test('hashes the verified password when only the env credential exists', async () => {
    await bootstrapOwnerFromLegacy('env-password')
    const data = mockUserCreate.mock.calls[0][0].data
    expect(data.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
  })
})
