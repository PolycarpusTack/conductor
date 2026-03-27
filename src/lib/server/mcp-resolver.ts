// MCP Tool Integration
// Tools are discovered from MCP servers via tools/list and passed to AI providers.
// When a model responds with tool_use, the adapter calls executeMcpTool() which
// executes the tool against the MCP server via tools/call and returns the result.
// The adapter loops until the model produces a final text response.

import { db } from '@/lib/db'

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
      console.error(`Failed to fetch tools from MCP "${connection.name}":`, error)
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
    console.warn(`MCP "${connection.name}" has no endpoint configured, skipping`)
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
    console.error(`Error fetching tools from ${endpoint}:`, error)
    return []
  }
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  mcpConnectionIds: string[],
): Promise<string> {
  console.log(`[MCP] Executing tool: ${toolName}`)
  // Parse the connection name and actual tool name from the namespaced format
  const separatorIndex = toolName.indexOf('__')
  if (separatorIndex === -1) {
    return JSON.stringify({ error: `Invalid tool name format: ${toolName}` })
  }

  const connectionName = toolName.substring(0, separatorIndex)
  const actualToolName = toolName.substring(separatorIndex + 2)

  const connections = await db.projectMcpConnection.findMany({
    where: { id: { in: mcpConnectionIds } },
  })

  const connection = connections.find(c => c.name === connectionName)
  if (!connection || !connection.endpoint) {
    return JSON.stringify({ error: `MCP connection "${connectionName}" not found or has no endpoint` })
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
      return JSON.stringify({ error: `MCP tool call failed: ${res.status}` })
    }

    const data = await res.json()
    const content = data.result?.content || []

    // Extract text content from MCP response
    const textParts = content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)

    console.log(`[MCP] Tool ${toolName} returned ${textParts.length} text parts`)
    return textParts.join('\n') || JSON.stringify(data.result || data)
  } catch (error) {
    return JSON.stringify({ error: `MCP tool execution error: ${error instanceof Error ? error.message : 'unknown'}` })
  }
}
