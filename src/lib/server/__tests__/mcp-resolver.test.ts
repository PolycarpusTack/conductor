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

beforeEach(() => {
  globalThis.fetch = originalFetch;
  (db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockReset()
})

describe('executeMcpTool', () => {
  test('returns error JSON for tool name without __ separator', async () => {
    const result = await executeMcpTool('notoolseparator', {}, ['conn1'])
    const parsed = JSON.parse(result)
    expect(parsed.error).toContain('Invalid tool name format')
    expect(parsed.error).toContain('notoolseparator')
  })

  test('returns error JSON when connection not found in provided IDs', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'other-conn', name: 'otherserver', endpoint: 'http://localhost:4000' },
    ])

    const result = await executeMcpTool('myserver__some_tool', {}, ['other-conn'])
    const parsed = JSON.parse(result)
    expect(parsed.error).toContain('"myserver" not found or has no endpoint')
  })

  test('returns error JSON when connection has no endpoint', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: null },
    ])

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result)
    expect(parsed.error).toContain('"myserver" not found or has no endpoint')
  })

  test('successfully calls MCP server and returns text content', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    globalThis.fetch = mock(() =>
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
    expect(result).toBe('Tool output here')
  })

  test('calls fetch with correct JSON-RPC payload', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001/' },
    ])

    let capturedBody: unknown
    globalThis.fetch = mock((url, init) => {
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
    globalThis.fetch = mock((url) => {
      capturedUrl = url as string
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: { content: [] } }),
      } as Response)
    })

    await executeMcpTool('myserver__do_thing', {}, ['conn1'])
    expect(capturedUrl).toBe('http://localhost:3001')
  })

  test('returns stringified result when no text parts in response', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    const mockResult = { content: [{ type: 'image', url: 'http://example.com/img.png' }], extra: 42 }
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ result: mockResult }),
      } as Response),
    )

    const result = await executeMcpTool('myserver__get_image', {}, ['conn1'])
    expect(result).toBe(JSON.stringify(mockResult))
  })

  test('joins multiple text parts with newline', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              content: [
                { type: 'text', text: 'Part one' },
                { type: 'image', url: 'http://example.com/img.png' },
                { type: 'text', text: 'Part two' },
              ],
            },
          }),
      } as Response),
    )

    const result = await executeMcpTool('myserver__multi', {}, ['conn1'])
    expect(result).toBe('Part one\nPart two')
  })

  test('returns error JSON when fetch fails with a network error', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    globalThis.fetch = mock(() => Promise.reject(new Error('ECONNREFUSED')))

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result)
    expect(parsed.error).toContain('MCP tool execution error')
    expect(parsed.error).toContain('ECONNREFUSED')
  })

  test('returns error JSON when MCP server returns non-OK status', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      } as Response),
    )

    const result = await executeMcpTool('myserver__some_tool', {}, ['conn1'])
    const parsed = JSON.parse(result)
    expect(parsed.error).toContain('MCP tool call failed')
    expect(parsed.error).toContain('503')
  })

  test('uses first __ separator so tool names with __ in them still work', async () => {
    ;(db.projectMcpConnection.findMany as ReturnType<typeof mock>).mockResolvedValue([
      { id: 'conn1', name: 'myserver', endpoint: 'http://localhost:3001' },
    ])

    let capturedBody: { params?: { name?: string } } | undefined
    globalThis.fetch = mock((_, init) => {
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
