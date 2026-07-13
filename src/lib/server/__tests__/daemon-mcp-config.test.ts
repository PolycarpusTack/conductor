import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// G1-3-T1 — buildDaemonMcpServers: ProjectMcpConnection rows → sanitized
// claude `mcpServers` fragment for the daemon Execution Payload.
//
// The core security assertion: NO secret value can enter the fragment —
// credential headers must be `${ENV_VAR}` templates (env indirection), and a
// literal value is refused loudly via configError.
// ---------------------------------------------------------------------------

import { dbMock } from './db-mock'

const mockConnFindMany = mock(() => Promise.resolve([] as unknown[])) as any

mock.module('@/lib/db', () => ({
  db: dbMock({ projectMcpConnection: { findMany: mockConnFindMany } }),
  isPostgresDb: false,
}))

import { buildDaemonMcpServers } from '../daemon-mcp-config'

function conn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mcp-1',
    name: 'GitHub Tools',
    endpoint: 'https://mcp.example.com/mcp',
    config: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockConnFindMany.mockReset()
  mockConnFindMany.mockResolvedValue([conn()])
})

describe('buildDaemonMcpServers', () => {
  test('returns null when the agent references no connections', async () => {
    expect(await buildDaemonMcpServers(null, 'p-1')).toBeNull()
    expect(await buildDaemonMcpServers('[]', 'p-1')).toBeNull()
    expect(await buildDaemonMcpServers('not-json', 'p-1')).toBeNull()
    expect(mockConnFindMany).not.toHaveBeenCalled()
  })

  test('maps a connection to an http server entry with a sanitized name', async () => {
    const fragment = await buildDaemonMcpServers('["mcp-1"]', 'p-1')
    expect(fragment).toEqual({
      servers: { 'GitHub-Tools': { type: 'http', url: 'https://mcp.example.com/mcp' } },
      configError: null,
    })
    // Lookup is project-scoped — a foreign project's connection id must not resolve.
    expect(mockConnFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ['mcp-1'] },
      projectId: 'p-1',
    })
  })

  test('ships env-indirection header templates verbatim', async () => {
    mockConnFindMany.mockResolvedValue([
      conn({ config: JSON.stringify({ headers: { Authorization: 'Bearer ${GH_MCP_TOKEN}', Accept: 'application/json' } }) }),
    ])
    const fragment = await buildDaemonMcpServers('["mcp-1"]', 'p-1')
    expect(fragment!.configError).toBeNull()
    expect(fragment!.servers['GitHub-Tools'].headers).toEqual({
      Authorization: 'Bearer ${GH_MCP_TOKEN}',
      Accept: 'application/json',
    })
  })

  test('refuses a literal credential in an auth header (secret guard)', async () => {
    mockConnFindMany.mockResolvedValue([
      conn({ config: JSON.stringify({ headers: { 'X-Api-Key': 'sk-live-1234567890' } }) }),
    ])
    const fragment = await buildDaemonMcpServers('["mcp-1"]', 'p-1')
    expect(fragment!.configError).toContain('X-Api-Key')
    expect(fragment!.configError).toContain('env')
    // The offending header must NOT ride the fragment.
    expect(fragment!.servers['GitHub-Tools'].headers).toBeUndefined()
  })

  test('unknown / cross-project connection ids surface as configError', async () => {
    mockConnFindMany.mockResolvedValue([])
    const fragment = await buildDaemonMcpServers('["mcp-ghost"]', 'p-1')
    expect(fragment!.servers).toEqual({})
    expect(fragment!.configError).toContain('mcp-ghost')
  })

  test('a connection without an http(s) endpoint surfaces as configError', async () => {
    mockConnFindMany.mockResolvedValue([conn({ endpoint: null })])
    const fragment = await buildDaemonMcpServers('["mcp-1"]', 'p-1')
    expect(fragment!.configError).toContain('GitHub Tools')
    expect(fragment!.servers).toEqual({})
  })

  test('name collisions after sanitization get a numeric suffix', async () => {
    mockConnFindMany.mockResolvedValue([
      conn({ id: 'mcp-1', name: 'my tools' }),
      conn({ id: 'mcp-2', name: 'my!tools', endpoint: 'https://other.example.com/mcp' }),
    ])
    const fragment = await buildDaemonMcpServers('["mcp-1","mcp-2"]', 'p-1')
    expect(Object.keys(fragment!.servers).sort()).toEqual(['my-tools', 'my-tools-2'])
  })
})
