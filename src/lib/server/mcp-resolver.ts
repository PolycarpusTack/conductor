// MCP Tool Integration
// Tools are discovered from MCP servers via tools/list and passed to AI providers.
// When a model responds with tool_use, the adapter calls executeMcpTool() which
// executes the tool against the MCP server via tools/call and returns the result.
// The adapter loops until the model produces a final text response.

import { db } from '@/lib/db'
import { scanForPromptInjection, wrapExternalContent } from '@/lib/server/content-safety'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('mcp-resolver')

interface McpTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

interface McpConnection {
  id: string
  name: string
  type: string
  endpoint?: string | null
  config?: string | null
  scopes?: string | null
}

/** Parses the scopes allowlist; null means "no restriction". */
export function parseScopes(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Mode-based tool filtering: which tool operations are allowed per mode
const MODE_TOOL_FILTERS: Record<string, (toolName: string) => boolean> = {
  analyze: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete') && !name.includes('update'),
  verify: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete') && !name.includes('update'),
  develop: () => true, // Full access
  review: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete'),
  draft: () => true,
  human: () => false, // No tools for human steps
}

/** Matches a namespaced tool name against an allowlist pattern (exact or `prefix*`). */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return toolName.startsWith(pattern.slice(0, -1))
  }
  return toolName === pattern
}

export async function resolveMcpTools(
  mcpConnectionIds: string[],
  mode: string,
  toolAllowlist?: string[] | null,
): Promise<McpTool[]> {
  if (mcpConnectionIds.length === 0) return []

  const connections = await db.projectMcpConnection.findMany({
    where: { id: { in: mcpConnectionIds } },
  })

  let allTools: McpTool[] = []

  for (const connection of connections) {
    try {
      const tools = await fetchToolsFromMcp(connection)
      allTools.push(...tools)
    } catch (error) {
      log.error('failed to fetch tools from MCP', error, { connection: connection.name })
      // Don't fail dispatch if one MCP is unreachable — just skip its tools
    }
  }

  // Layer 1: built-in mode heuristics (read-only modes lose write-ish tools)
  const modeFilter = MODE_TOOL_FILTERS[mode]
  if (modeFilter) {
    allTools = allTools.filter(tool => modeFilter(tool.name.toLowerCase()))
  }

  // Layer 2 (Epic S4): the mode's explicit allowlist narrows further.
  // Patterns are namespaced names, exact or prefix glob ("conn__*").
  if (toolAllowlist && toolAllowlist.length > 0) {
    allTools = allTools.filter(tool =>
      toolAllowlist.some(pattern => matchesToolPattern(tool.name, pattern)),
    )
  }

  return allTools
}

async function fetchToolsFromMcp(connection: McpConnection): Promise<McpTool[]> {
  if (!connection.endpoint) {
    log.warn('MCP has no endpoint configured, skipping', { connection: connection.name })
    return []
  }

  const endpoint = connection.endpoint.replace(/\/$/, '')

  try {
    // MCP protocol: POST to the server with a tools/list request.
    // A slow MCP server would otherwise stall every dispatch — tool discovery
    // runs on each step that uses MCP. 5s is generous; healthy servers reply
    // in milliseconds.
    const res = await fetch(`${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      throw new Error(`MCP server returned ${res.status}`)
    }

    const data = await res.json()

    // MCP protocol response format
    let tools = data.result?.tools || data.tools || []

    // Per-tool allowlist (Epic S5): `scopes` holds enabled raw tool names.
    // null = no restriction (back-compat), [] = everything disabled.
    const scopes = parseScopes(connection.scopes)
    if (scopes !== null) {
      const allowed = new Set(scopes)
      tools = tools.filter((tool: { name: string }) => allowed.has(tool.name))
    }

    return tools.map((tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
      name: `${connection.name}__${tool.name}`,  // Namespace tools by connection
      description: tool.description || `Tool from ${connection.name}`,
      input_schema: tool.inputSchema || { type: 'object', properties: {} },
    }))
  } catch (error) {
    log.error('error fetching tools from MCP endpoint', error, { endpoint })
    return []
  }
}

export interface McpToolResult {
  text: string
  artifacts: Array<{
    type: string
    label: string
    content?: string
    url?: string
    mimeType?: string
  }>
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  mcpConnectionIds: string[],
): Promise<McpToolResult> {
  log.debug('executing tool', { toolName })
  // Parse the connection name and actual tool name from the namespaced format
  const separatorIndex = toolName.indexOf('__')
  if (separatorIndex === -1) {
    return { text: JSON.stringify({ error: `Invalid tool name format: ${toolName}` }), artifacts: [] }
  }

  const connectionName = toolName.substring(0, separatorIndex)
  const actualToolName = toolName.substring(separatorIndex + 2)

  const connections = await db.projectMcpConnection.findMany({
    where: { id: { in: mcpConnectionIds } },
  })

  const connection = connections.find(c => c.name === connectionName)
  if (!connection || !connection.endpoint) {
    return { text: JSON.stringify({ error: `MCP connection "${connectionName}" not found or has no endpoint` }), artifacts: [] }
  }

  // Per-tool usage counter (Epic S5) — fire-and-forget; stats must never
  // slow down or fail a tool call.
  db.mcpToolUsage.upsert({
    where: { connectionId_toolName: { connectionId: connection.id, toolName: actualToolName } },
    create: { connectionId: connection.id, toolName: actualToolName, count: 1 },
    update: { count: { increment: 1 }, lastUsedAt: new Date() },
  }).catch(() => {})

  const endpoint = connection.endpoint.replace(/\/$/, '')

  try {
    // Tool execution can legitimately do real work (DB queries, HTTP calls,
    // file ops) — give it a longer ceiling than tool discovery. 30s caps a
    // wedged tool without killing normal ones. The step-level timeout
    // (agent.timeoutMs, default 5 min) still governs the outer dispatch.
    const res = await fetch(`${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: actualToolName,
          arguments: args,
        },
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      return { text: JSON.stringify({ error: `MCP tool call failed: ${res.status}` }), artifacts: [] }
    }

    const data = await res.json()
    const content = data.result?.content || []

    // Extract text content from MCP response
    const textParts = content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)

    // Extract non-text content as artifacts
    const artifacts: McpToolResult['artifacts'] = []
    for (const item of content) {
      if (item.type === 'image') {
        artifacts.push({
          type: 'image',
          label: `Image from ${actualToolName}`,
          url: item.data ? `data:${item.mimeType || 'image/png'};base64,${item.data}` : undefined,
          mimeType: item.mimeType || 'image/png',
        })
      } else if (item.type === 'resource') {
        artifacts.push({
          type: 'file',
          label: item.resource?.name || `Resource from ${actualToolName}`,
          url: item.resource?.uri,
          content: item.resource?.text,
          mimeType: item.resource?.mimeType,
        })
      } else if (item.type !== 'text') {
        // Catch-all for other non-text types
        artifacts.push({
          type: 'json',
          label: `${item.type} from ${actualToolName}`,
          content: JSON.stringify(item),
        })
      }
    }

    log.debug('tool result', { toolName, textParts: textParts.length, artifacts: artifacts.length })
    let text = textParts.join('\n') || JSON.stringify(data.result || data)

    // Tool results loop straight back into the LLM conversation — a hostile
    // tool response is a prompt-injection vector. Scan always; wrap only when
    // flagged so trusted-looking results pass through byte-identical.
    const safetyFlags = scanForPromptInjection(text)
    if (safetyFlags.length > 0) {
      log.warn('prompt-injection patterns in tool result — wrapping as data', {
        toolName,
        categories: safetyFlags.map((f) => f.category),
      })
      text = wrapExternalContent({
        text,
        source: `mcp:${connectionName}/${actualToolName}`,
        trust: 'external',
      }).text
    }

    return { text, artifacts }
  } catch (error) {
    return { text: JSON.stringify({ error: `MCP tool execution error: ${error instanceof Error ? error.message : 'unknown'}` }), artifacts: [] }
  }
}
