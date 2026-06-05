import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockConnectionFindUnique = mock(() => Promise.resolve(null)) as any
const mockExecutionFindMany = mock(() => Promise.resolve([])) as any

mock.module('@/lib/db', () => ({
  db: {
    projectMcpConnection: { findUnique: mockConnectionFindUnique },
    stepExecution: { findMany: mockExecutionFindMany },
  },
  isPostgresDb: false,
}))

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = originalFetch
  mockConnectionFindUnique.mockReset()
  mockConnectionFindUnique.mockResolvedValue(null)
  mockExecutionFindMany.mockReset()
  mockExecutionFindMany.mockResolvedValue([])
})

const discoverParams = { params: Promise.resolve({ id: 'p-1', cid: 'conn-1' }) }

describe('POST /api/projects/[id]/mcp-connections/[cid]/discover', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/projects/[id]/mcp-connections/[cid]/discover/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/mcp-connections/conn-1/discover', { method: 'POST', body: {} }),
      discoverParams,
    )
    expect(res.status).toBe(401)
  })

  test('404 for a connection in another project', async () => {
    setSession(ADMIN_SESSION)
    mockConnectionFindUnique.mockResolvedValue({ id: 'conn-1', projectId: 'p-OTHER', endpoint: 'http://x' })
    const { POST } = await import('@/app/api/projects/[id]/mcp-connections/[cid]/discover/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/mcp-connections/conn-1/discover', { method: 'POST', body: {} }),
      discoverParams,
    )
    expect(res.status).toBe(404)
  })

  test('returns tools with enabled state derived from scopes', async () => {
    setSession(ADMIN_SESSION)
    mockConnectionFindUnique.mockResolvedValue({
      id: 'conn-1',
      projectId: 'p-1',
      endpoint: 'http://localhost:3001',
      scopes: '["read_file"]',
    })
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: { tools: [{ name: 'read_file', description: 'Read' }, { name: 'write_file' }] },
          }),
      } as Response),
    ) as unknown as typeof fetch

    const { POST } = await import('@/app/api/projects/[id]/mcp-connections/[cid]/discover/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/mcp-connections/conn-1/discover', { method: 'POST', body: {} }),
      discoverParams,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tools).toEqual([
      { name: 'read_file', description: 'Read', enabled: true },
      { name: 'write_file', description: null, enabled: false },
    ])
  })

  test('502 when the MCP server is unreachable', async () => {
    setSession(ADMIN_SESSION)
    mockConnectionFindUnique.mockResolvedValue({
      id: 'conn-1', projectId: 'p-1', endpoint: 'http://localhost:9', scopes: null,
    })
    globalThis.fetch = mock(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch

    const { POST } = await import('@/app/api/projects/[id]/mcp-connections/[cid]/discover/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/mcp-connections/conn-1/discover', { method: 'POST', body: {} }),
      discoverParams,
    )
    expect(res.status).toBe(502)
  })
})

describe('GET /api/projects/[id]/runtimes/usage', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/runtimes/usage/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/runtimes/usage'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(401)
  })

  test('aggregates executions per runtime', async () => {
    setSession(ADMIN_SESSION)
    mockExecutionFindMany.mockResolvedValue([
      { tokensUsed: 100, cost: 0.01, step: { agent: { runtimeId: 'rt-1' } } },
      { tokensUsed: 200, cost: 0.02, step: { agent: { runtimeId: 'rt-1' } } },
      { tokensUsed: null, cost: null, step: { agent: { runtimeId: 'rt-2' } } },
    ])
    const { GET } = await import('@/app/api/projects/[id]/runtimes/usage/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/runtimes/usage'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.usage['rt-1']).toEqual({ executions: 2, tokens: 300, cost: 0.03 })
    expect(body.usage['rt-2']).toEqual({ executions: 1, tokens: 0, cost: 0 })
  })
})
