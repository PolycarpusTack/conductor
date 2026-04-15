import { describe, test, expect, mock, beforeEach } from 'bun:test'

// Mock the db module before importing the module under test
mock.module('@/lib/db', () => ({
  db: {
    projectMcpConnection: {
      findMany: mock(() => Promise.resolve([])),
    },
  },
}))

// Import AFTER mocking
import { executeMcpTool } from '../mcp-resolver'
import { db } from '@/lib/db'

const originalFetch = globalThis.fetch

function setMockFetch(impl: (...args: any[]) => Promise<Response>) {
  globalThis.fetch = mock(impl) as unknown as typeof fetch
}

beforeEach(() => {
  globalThis.fetch = originalFetch;
  (db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockReset()
})

describe('executeMcpTool', () => {
  test('returns error JSON for tool name without __ separator', async () => {
    const result = await executeMcpTool('notoolseparator', {}, ['conn1'])
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain('Invalid tool name format')
    expect(parsed.error).toContain('notoolseparator')
    expect(result.artifacts).toEqual([])
  })

  test('returns error JSON when connection not found in provided IDs', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'other-conn', name: 'otherserver', endpoint: 'http://localhost:4000' },
    ])

    const result = await executeMcpTool('myserver__some_tool', {}, ['other-conn'])
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain('"myserver" not found or has no endpoint')
    expect(result.artifacts).toEqual([])
  })

  test('returns error JSON when connection has no endpoint', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: null },
    ])

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain('"myserver" not found or has no endpoint')
    expect(result.artifacts).toEqual([])
  })

  test('successfully calls MCP server and returns text content', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    setMockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              content: [{ type: 'text', text: 'Tool output here' }],
            },
          }),
      } as Response),
    )

    const result = await executeMcpTool('myserver__run_query', { q: 'hello' }, ['conn1'])
    expect(result.text).toBe('Tool output here')
    expect(result.artifacts).toEqual([])
  })

  test('calls fetch with correct JSON-RPC payload', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001/' },
    ])

    let capturedBody: unknown
    setMockFetch((url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string)
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: { content: [{ type: 'text', text: 'ok' }] },
          }),
      } as Response)
    })

    await executeMcpTool('myserver__run_query', { limit: 10 }, ['conn1'])

    expect(capturedBody).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'run_query',
        arguments: { limit: 10 },
      },
    })
  })

  test('strips trailing slash from endpoint before calling fetch', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001/' },
    ])

    let capturedUrl: string | undefined
    setMockFetch((url) => {
      capturedUrl = url as string
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { content: [] } }),
      } as Response)
    })

    await executeMcpTool('myserver__do_thing', {}, ['conn1'])
    expect(capturedUrl).toBe('http://localhost:3001')
  })

  test('returns stringified result when no text parts and extracts non-text as artifacts', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    const mockResult = { content: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }], extra: 42 }
    setMockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: mockResult }),
      } as Response),
    )

    const result = await executeMcpTool('myserver__get_image', {}, ['conn1'])
    expect(result.text).toBe(JSON.stringify(mockResult))
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0].type).toBe('image')
  })

  test('joins multiple text parts with newline and extracts non-text as artifacts', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    setMockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              content: [
                { type: 'text', text: 'Part one' },
                { type: 'image', data: 'abc', mimeType: 'image/png' },
                { type: 'text', text: 'Part two' },
              ],
            },
          }),
      } as Response),
    )

    const result = await executeMcpTool('myserver__multi', {}, ['conn1'])
    expect(result.text).toBe('Part one\nPart two')
    expect(result.artifacts).toHaveLength(1)
    expect(result.artifacts[0].type).toBe('image')
  })

  test('returns error JSON when fetch fails with a network error', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    setMockFetch(() => Promise.reject(new Error('ECONNREFUSED')))

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain('MCP tool execution error')
    expect(parsed.error).toContain('ECONNREFUSED')
    expect(result.artifacts).toEqual([])
  })

  test('returns error JSON when MCP server returns non-OK status', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    setMockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      } as Response),
    )

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result.text)
    expect(parsed.error).toContain('MCP tool call failed')
    expect(parsed.error).toContain('503')
    expect(result.artifacts).toEqual([])
  })

  test('uses first __ separator so tool names with __ in them still work', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    let capturedBody: { params?: { name?: string } } | undefined
    setMockFetch((_, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string)
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { content: [{ type: 'text', text: 'ok' }] } }),
      } as Response)
    })

    await executeMcpTool('myserver__tool__with__underscores', {}, ['conn1'])
    expect(capturedBody?.params?.name).toBe('tool__with__underscores')
  })
})
