// MCP Tool Integration
// Tools are discovered from MCP servers via tools/list and passed to AI providers.
// When a model responds with tool_use, the adapter calls executeMcpTool() which
// executes the tool against the MCP server via tools/call and returns the result.
// The adapter loops until the model produces a final text response.

import { db } from '@/lib/db'
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

// Mode-based tool filtering: which tool operations are allowed per mode
const MODE_TOOL_FILTERS: Record<string, (toolName: string) => boolean> = {
  analyze: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete') && !name.includes('update'),
  verify: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete') && !name.includes('update'),
  develop: () => true, // Full access
  review: (name) => !name.includes('write') && !name.includes('create') && !name.includes('delete'),
  draft: () => true,
  human: () => false, // No tools for human steps
}

export async function resolveMcpTools(
  mcpConnectionIds: string[],
  mode: string,
): Promise<McpTool[]> {
  if (mcpConnectionIds.length === 0) return []

  const connections = await db.projectMcpConnection.findMany({
    where: { id: { in: mcpConnectionIds } },
  })

  const allTools: McpTool[] = []

  for (const connection of connections) {
    try {
      const tools = await fetchToolsFromMcp(connection)
      allTools.push(...tools)
    } catch (error) {
      log.error('failed to fetch tools from MCP', error, { connection: connection.name })
      // Don't fail dispatch if one MCP is unreachable — just skip its tools
    }
  }

  // Filter tools based on mode permissions
  const modeFilter = MODE_TOOL_FILTERS[mode]
  if (modeFilter) {
    return allTools.filter(tool => modeFilter(tool.name.toLowerCase()))
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
    // MCP protocol: POST to the server with a tools/list request
    const res = await fetch(`${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    })

    if (!res.ok) {
      throw new Error(`MCP server returned ${res.status}`)
    }

    const data = await res.json()

    // MCP protocol response format
    const tools = data.result?.tools || data.tools || []

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

  const endpoint = connection.endpoint.replace(/\/$/, '')

  try {
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
    const text = textParts.join('\n') || JSON.stringify(data.result || data)
    return { text, artifacts }
  } catch (error) {
    return { text: JSON.stringify({ error: `MCP tool execution error: ${error instanceof Error ? error.message : 'unknown'}` }), artifacts: [] }
  }
}
