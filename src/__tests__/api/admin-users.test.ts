import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, OWNER_SESSION, MEMBER_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockUserFindMany = mock(() => Promise.resolve([])) as any
const mockUserFindUnique = mock(() => Promise.resolve(null)) as any
const mockUserCount = mock(() => Promise.resolve(0)) as any
const mockUserUpdate = mock((args: any) => Promise.resolve({ id: 'u-2', ...args.data })) as any
const mockUserCreate = mock((args: any) => Promise.resolve({ id: 'u-9', ...args.data })) as any
const mockSessionDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any

mock.module('@/lib/db', () => ({
  db: {
    user: {
      findMany: mockUserFindMany,
      findUnique: mockUserFindUnique,
      count: mockUserCount,
      update: mockUserUpdate,
      create: mockUserCreate,
    },
    userSession: { deleteMany: mockSessionDeleteMany },
  },
  isPostgresDb: false,
}))

beforeEach(() => {
  for (const m of [
    mockUserFindMany, mockUserFindUnique, mockUserCount,
    mockUserUpdate, mockUserCreate, mockSessionDeleteMany,
  ]) m.mockReset()
  mockUserFindMany.mockResolvedValue([])
  mockUserFindUnique.mockResolvedValue(null)
  mockUserCount.mockResolvedValue(2)
  mockUserUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'u-2', ...args.data }))
  mockUserCreate.mockImplementation((args: any) => Promise.resolve({ id: 'u-9', ...args.data }))
  mockSessionDeleteMany.mockResolvedValue({ count: 0 })
  setSession(ADMIN_SESSION)
})

const itemParams = { params: Promise.resolve({ userId: 'u-2' }) }

describe('GET/POST /api/admin/users', () => {
  test('member gets 403', async () => {
    setSession(MEMBER_SESSION)
    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(makeRequest('http://localhost/api/admin/users'), {} as any)
    expect(res.status).toBe(403)
  })

  test('admin creates a member and receives a one-time temp password', async () => {
    const { POST } = await import('@/app/api/admin/users/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/users', {
        method: 'POST',
        body: { email: 'new@example.com', name: 'Newbie' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(12)
    expect(mockUserCreate.mock.calls[0][0].data).toMatchObject({ email: 'new@example.com', role: 'member' })
    // password is stored hashed, never plaintext
    expect(mockUserCreate.mock.calls[0][0].data.passwordHash).not.toBe(body.tempPassword)
  })

  test('admin cannot mint an owner', async () => {
    const { POST } = await import('@/app/api/admin/users/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/users', {
        method: 'POST',
        body: { email: 'boss@example.com', name: 'Boss', role: 'owner' },
      }),
      {} as any,
    )
    expect(res.status).toBe(400)
    expect(mockUserCreate).not.toHaveBeenCalled()
  })

  test('owner can mint an owner', async () => {
    setSession(OWNER_SESSION)
    const { POST } = await import('@/app/api/admin/users/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/users', {
        method: 'POST',
        body: { email: 'boss@example.com', name: 'Boss', role: 'owner' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
  })

  test('duplicate email conflicts', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-2' })
    const { POST } = await import('@/app/api/admin/users/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/users', {
        method: 'POST',
        body: { email: 'new@example.com', name: 'Dup' },
      }),
      {} as any,
    )
    expect(res.status).toBe(409)
  })
})

describe('PUT /api/admin/users/[userId]', () => {
  test('admin cannot manage an owner account', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-2', role: 'owner', isActive: true })
    const { PUT } = await import('@/app/api/admin/users/[userId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/users/u-2', { method: 'PUT', body: { isActive: false } }),
      itemParams,
    )
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  test('no self-deactivation', async () => {
    // ADMIN_SESSION id is user-1; target the same id
    mockUserFindUnique.mockResolvedValue({ id: 'user-1', role: 'admin', isActive: true })
    const { PUT } = await import('@/app/api/admin/users/[userId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/users/user-1', { method: 'PUT', body: { isActive: false } }),
      { params: Promise.resolve({ userId: 'user-1' }) },
    )
    expect(res.status).toBe(400)
  })

  test('the last active owner cannot be demoted', async () => {
    setSession(OWNER_SESSION)
    mockUserFindUnique.mockResolvedValue({ id: 'u-2', role: 'owner', isActive: true })
    mockUserCount.mockResolvedValue(1)
    const { PUT } = await import('@/app/api/admin/users/[userId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/users/u-2', { method: 'PUT', body: { role: 'member' } }),
      itemParams,
    )
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  test('deactivation revokes the user sessions', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-2', role: 'member', isActive: true })
    const { PUT } = await import('@/app/api/admin/users/[userId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/users/u-2', { method: 'PUT', body: { isActive: false } }),
      itemParams,
    )
    expect(res.status).toBe(200)
    expect(mockSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u-2' } })
  })

  test('password reset returns a temp password and revokes sessions', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-2', role: 'member', isActive: true })
    const { PUT } = await import('@/app/api/admin/users/[userId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/users/u-2', { method: 'PUT', body: { resetPassword: true } }),
      itemParams,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(12)
    expect(mockUserUpdate.mock.calls[0][0].data.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(mockSessionDeleteMany).toHaveBeenCalled()
  })
})

describe('role enforcement on the privileged surface', () => {
  test('member gets 403 on project DELETE', async () => {
    setSession(MEMBER_SESSION)
    const { DELETE } = await import('@/app/api/projects/[id]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/p-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'p-1' }) },
    )
    expect(res.status).toBe(403)
  })

  test('member gets 403 on security config', async () => {
    setSession(MEMBER_SESSION)
    const { GET } = await import('@/app/api/admin/security/config/route')
    const res = await GET(makeRequest('http://localhost/api/admin/security/config'), {} as any)
    expect(res.status).toBe(403)
  })
})
