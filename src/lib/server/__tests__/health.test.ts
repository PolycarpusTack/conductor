import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// this factory must expose the full export surface of the real module.
const mockCount = mock(() => Promise.resolve(1)) as any

mock.module('@/lib/db', () => ({
  db: { project: { count: mockCount } },
  isPostgresDb: false,
}))

import { getHealthStatus } from '../health'

beforeEach(() => {
  mockCount.mockReset()
  mockCount.mockImplementation(() => Promise.resolve(1))
})

describe('getHealthStatus', () => {
  test('returns ok when DB responds and env is valid', async () => {
    mockCount.mockResolvedValueOnce(3)
    const status = await getHealthStatus()
    expect(status.status).toBe('ok')
    expect(status.db).toBe('ok')
    expect(status.env).toBe('ok')
    expect(status.envIssues).toEqual([])
    expect(status.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(status.uptime).toBeGreaterThan(0)
  })

  test('returns degraded when DB throws', async () => {
    mockCount.mockRejectedValueOnce(new Error('DB is down'))
    const status = await getHealthStatus()
    expect(status.status).toBe('degraded')
    expect(status.db).toBe('error')
  })

  test('reports invalid env without leaking values', async () => {
    const original = process.env.AGENTBOARD_ADMIN_SESSION_SECRET
    process.env.AGENTBOARD_ADMIN_SESSION_SECRET = 'short'
    try {
      const status = await getHealthStatus()
      expect(status.status).toBe('degraded')
      expect(status.env).toBe('invalid')
      expect(status.envIssues.join(' ')).toContain('AGENTBOARD_ADMIN_SESSION_SECRET')
      expect(JSON.stringify(status)).not.toContain('short ')
    } finally {
      if (original === undefined) delete process.env.AGENTBOARD_ADMIN_SESSION_SECRET
      else process.env.AGENTBOARD_ADMIN_SESSION_SECRET = original
    }
  })
})
