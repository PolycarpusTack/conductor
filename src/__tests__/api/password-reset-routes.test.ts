import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// Route orchestration tests (D-5-T2). We exercise the REAL password-reset
// service against a mocked db + an injected fake mail transport, so these
// cover the invite / request / confirm wiring end to end.

const mockUserFindUnique = mock(() => Promise.resolve(null)) as any
const mockUserCreate = mock((args: any) => Promise.resolve({ id: 'u-9', ...args.data })) as any
const mockUserUpdate = mock((args: any) => Promise.resolve({ id: 'u-9', ...args.data })) as any
const mockUserCount = mock(() => Promise.resolve(2)) as any
const mockResetCreate = mock((args: any) => Promise.resolve({ id: 'rt-1', ...args.data })) as any
const mockResetFindUnique = mock(() => Promise.resolve(null)) as any
const mockResetUpdate = mock((args: any) => Promise.resolve({ id: 'rt-1', ...args.data })) as any
const mockSessionDeleteMany = mock(() => Promise.resolve({ count: 0 })) as any

mock.module('@/lib/db', () => ({
  db: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
      update: mockUserUpdate,
      count: mockUserCount,
    },
    passwordResetToken: {
      create: mockResetCreate,
      findUnique: mockResetFindUnique,
      update: mockResetUpdate,
    },
    userSession: { deleteMany: mockSessionDeleteMany },
  },
  isPostgresDb: false,
}))

import { setResetEmailDeps, resetResetEmailDeps } from '@/lib/server/password-reset'

const sentMail: Array<{ to: string; subject: string; text: string }> = []
const fakeTransport = {
  sendMail: (opts: any) => {
    sentMail.push(opts)
    return Promise.resolve({})
  },
}

beforeEach(() => {
  for (const m of [
    mockUserFindUnique, mockUserCreate, mockUserUpdate, mockUserCount,
    mockResetCreate, mockResetFindUnique, mockResetUpdate, mockSessionDeleteMany,
  ]) m.mockReset()
  mockUserFindUnique.mockResolvedValue(null)
  mockUserCreate.mockImplementation((args: any) => Promise.resolve({ id: 'u-9', ...args.data }))
  mockUserUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'u-9', ...args.data }))
  mockUserCount.mockResolvedValue(2)
  mockResetCreate.mockImplementation((args: any) => Promise.resolve({ id: 'rt-1', ...args.data }))
  mockResetFindUnique.mockResolvedValue(null)
  mockResetUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'rt-1', ...args.data }))
  mockSessionDeleteMany.mockResolvedValue({ count: 0 })
  sentMail.length = 0
  setSession(ADMIN_SESSION)
  setResetEmailDeps({ createSmtpTransport: () => fakeTransport })
  delete process.env.SMTP_HOST
})

afterEach(() => {
  resetResetEmailDeps()
  delete process.env.SMTP_HOST
})

describe('POST /api/admin/users (invite)', () => {
  test('emails a set-password link and hides the temp password when SMTP is set', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
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
    expect(body.invited).toBe(true)
    expect(body.tempPassword).toBeUndefined()

    // a reset token was issued (hash only) and an invite email was sent
    expect(mockResetCreate).toHaveBeenCalled()
    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].to).toBe('new@example.com')
    expect(sentMail[0].text).toContain('/set-password?token=')
  })

  test('falls back to returning a temp password when SMTP is not configured', async () => {
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
    expect(mockResetCreate).not.toHaveBeenCalled()
    expect(sentMail).toHaveLength(0)
  })
})

describe('POST /api/auth/reset/request', () => {
  test('unknown email never enumerates — 200, no token, no email', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    mockUserFindUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/auth/reset/request/route')
    const res = await POST(
      makeRequest('http://localhost/api/auth/reset/request', {
        method: 'POST',
        body: { email: 'ghost@example.com' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockResetCreate).not.toHaveBeenCalled()
    expect(sentMail).toHaveLength(0)
  })

  test('known active user is emailed a reset link (still 200)', async () => {
    process.env.SMTP_HOST = 'smtp.example.com'
    mockUserFindUnique.mockResolvedValue({ id: 'u-1', email: 'dev@example.com', name: 'Dev', isActive: true })
    const { POST } = await import('@/app/api/auth/reset/request/route')
    const res = await POST(
      makeRequest('http://localhost/api/auth/reset/request', {
        method: 'POST',
        body: { email: 'dev@example.com' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
    expect(mockResetCreate).toHaveBeenCalled()
    expect(sentMail).toHaveLength(1)
    expect(sentMail[0].to).toBe('dev@example.com')
  })

  test('never sends when SMTP is unconfigured (still 200)', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'u-1', email: 'dev@example.com', name: 'Dev', isActive: true })
    const { POST } = await import('@/app/api/auth/reset/request/route')
    const res = await POST(
      makeRequest('http://localhost/api/auth/reset/request', {
        method: 'POST',
        body: { email: 'dev@example.com' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
    expect(sentMail).toHaveLength(0)
    expect(mockResetCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/reset/confirm', () => {
  test('valid token sets the password (marks used + revokes sessions) → 200', async () => {
    mockResetFindUnique.mockResolvedValue({
      id: 'rt-1', userId: 'u-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null,
    })
    const { POST } = await import('@/app/api/auth/reset/confirm/route')
    const res = await POST(
      makeRequest('http://localhost/api/auth/reset/confirm', {
        method: 'POST',
        body: { token: 'cr_deadbeef', password: 'a-good-password' },
      }),
      {} as any,
    )
    expect(res.status).toBe(200)
    expect(mockUserUpdate.mock.calls[0][0].data.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
    expect(mockResetUpdate.mock.calls[0][0].data.usedAt).toBeInstanceOf(Date)
    expect(mockSessionDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } })
  })

  test('bad / unknown token → 400, no password change', async () => {
    mockResetFindUnique.mockResolvedValue(null)
    const { POST } = await import('@/app/api/auth/reset/confirm/route')
    const res = await POST(
      makeRequest('http://localhost/api/auth/reset/confirm', {
        method: 'POST',
        body: { token: 'cr_nope', password: 'a-good-password' },
      }),
      {} as any,
    )
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })
})
