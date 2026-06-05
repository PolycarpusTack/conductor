import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { notFound, withErrorHandling } from '@/lib/server/api-errors'
import { parseScopes } from '@/lib/server/mcp-resolver'

/**
 * POST /api/projects/[id]/mcp-connections/[cid]/discover — fetch the
 * server's live tool list (tools/list) and report each tool's enabled
 * state per the connection's scopes allowlist. Admin-triggered.
 */
export const POST = withErrorHandling(
  'api/projects/[id]/mcp-connections/[cid]/discover',
  async (request: Request, { params }: { params: Promise<{ id: string; cid: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id: projectId, cid } = await params
    const connection = await db.projectMcpConnection.findUnique({ where: { id: cid } })
    if (!connection || connection.projectId !== projectId) throw notFound('MCP connection not found')
    if (!connection.endpoint) {
      return NextResponse.json({ error: 'Connection has no endpoint configured' }, { status: 422 })
    }

    try {
      const res = await fetch(connection.endpoint.replace(/\/$/, ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        return NextResponse.json({ error: `MCP server returned ${res.status}` }, { status: 502 })
      }

      const data = await res.json()
      const rawTools: Array<{ name: string; description?: string }> =
        data.result?.tools || data.tools || []

      const scopes = parseScopes(connection.scopes)
      const allowed = scopes === null ? null : new Set(scopes)

      return NextResponse.json({
        tools: rawTools.map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          enabled: allowed === null ? true : allowed.has(tool.name),
        })),
      })
    } catch {
      return NextResponse.json({ error: 'MCP server unreachable' }, { status: 502 })
    }
  },
)
