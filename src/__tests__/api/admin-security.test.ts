import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockConfigFindUnique = mock(() => Promise.resolve(null)) as any
const mockConfigUpsert = mock(() => Promise.resolve({})) as any
const mockAgentFindUnique = mock(() => Promise.resolve(null)) as any
const mockAgentCreate = mock(() => Promise.resolve({ id: 'agent-copy' })) as any

mock.module('@/lib/db', () => ({
  db: {
    adminConfig: { findUnique: mockConfigFindUnique, upsert: mockConfigUpsert },
    agent: { findUnique: mockAgentFindUnique, create: mockAgentCreate },
  },
  isPostgresDb: false,
}))

import { invalidateAdminConfigCache, scryptVerify } from '@/lib/server/admin-config'

beforeEach(() => {
  invalidateAdminConfigCache()
  mockConfigFindUnique.mockReset()
  mockConfigFindUnique.mockResolvedValue(null)
  mockConfigUpsert.mockReset()
  mockConfigUpsert.mockResolvedValue({})
  mockAgentFindUnique.mockReset()
  mockAgentFindUnique.mockResolvedValue(null)
  mockAgentCreate.mockReset()
  mockAgentCreate.mockImplementation(({ data }: any) => Promise.resolve(data))
})

const noParams = { params: Promise.resolve({}) }

describe('POST /api/admin/security/password', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/admin/security/password/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/security/password', {
        method: 'POST',
        body: { currentPassword: 'x', newPassword: 'long-enough-1' },
      }),
      noParams,
    )
    expect(res.status).toBe(401)
  })

  // NOTE: admin-session is globally mocked by the auth helper —
  // verifyAdminPassword accepts only 'test-password'. The real layered
  // verification (DB scrypt → env fallback) is covered by admin-config tests.
  test('rejects a wrong current password', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/admin/security/password/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/security/password', {
        method: 'POST',
        body: { currentPassword: 'wrong-password', newPassword: 'new-password-123' },
      }),
      noParams,
    )
    expect(res.status).toBe(401)
    expect(mockConfigUpsert).not.toHaveBeenCalled()
  })

  test('changes the password when the current one verifies', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/admin/security/password/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/security/password', {
        method: 'POST',
        body: { currentPassword: 'test-password', newPassword: 'new-password-123' },
      }),
      noParams,
    )
    expect(res.status).toBe(200)
    expect(mockConfigUpsert).toHaveBeenCalledTimes(1)
    expect(scryptVerify('new-password-123', mockConfigUpsert.mock.calls[0][0].create.passwordHash)).toBe(true)
  })

  test('400 for a too-short new password', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/admin/security/password/route')
    const res = await POST(
      makeRequest('http://localhost/api/admin/security/password', {
        method: 'POST',
        body: { currentPassword: 'x', newPassword: 'short' },
      }),
      noParams,
    )
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/admin/security/config', () => {
  test('bounds the session TTL', async () => {
    setSession(ADMIN_SESSION)
    const { PUT } = await import('@/app/api/admin/security/config/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/security/config', {
        method: 'PUT',
        body: { sessionTtlHours: 10_000 },
      }),
      noParams,
    )
    expect(res.status).toBe(400)
  })

  test('updates the TTL', async () => {
    setSession(ADMIN_SESSION)
    const { PUT } = await import('@/app/api/admin/security/config/route')
    const res = await PUT(
      makeRequest('http://localhost/api/admin/security/config', {
        method: 'PUT',
        body: { sessionTtlHours: 48 },
      }),
      noParams,
    )
    expect(res.status).toBe(200)
    expect(mockConfigUpsert.mock.calls[0][0].update).toEqual({ sessionTtlHours: 48 })
  })
})

describe('POST /api/agents/[id]/duplicate', () => {
  const dupParams = { params: Promise.resolve({ id: 'agent-1' }) }

  test('404 for unknown agent', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/agents/[id]/duplicate/route')
    const res = await POST(
      makeRequest('http://localhost/api/agents/agent-1/duplicate', { method: 'POST', body: {} }),
      dupParams,
    )
    expect(res.status).toBe(404)
  })

  test('clones config with a fresh key, inactive by default', async () => {
    setSession(ADMIN_SESSION)
    mockAgentFindUnique.mockResolvedValue({
      id: 'agent-1', projectId: 'p-1', name: 'Alice', emoji: '🔬', color: '#fff',
      description: 'analyst', role: 'analyst', personality: null, capabilities: null,
      maxConcurrent: 2, supportedModes: '["analyze"]', modeInstructions: null,
      invocationMode: 'HTTP', runtimeId: 'rt-1', runtimeModel: 'sonnet',
      systemPrompt: 'You are Alice.', mcpConnectionIds: null,
    })
    const { POST } = await import('@/app/api/agents/[id]/duplicate/route')
    const res = await POST(
      makeRequest('http://localhost/api/agents/agent-1/duplicate', { method: 'POST', body: {} }),
      dupParams,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.rawKey).toMatch(/^ab_agent\./)
    expect(body.agent.name).toBe('Alice (copy)')
    const created = mockAgentCreate.mock.calls[0][0].data
    expect(created.isActive).toBe(false)
    expect(created.runtimeId).toBe('rt-1')
    expect(created.apiKeyHash).toBeTruthy()
  })
})
