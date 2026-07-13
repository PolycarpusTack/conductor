// G1-3-T1 (gap 1.6): MCP servers for DAEMON-path steps.
//
// The claude CLI is a spec-compliant MCP client, so on the daemon path the
// spawned CLI talks to the MCP servers directly — Conductor's mcp-resolver is
// not in the loop. The server's job is only to translate the agent's
// ProjectMcpConnection rows into a sanitized `mcpServers` config fragment the
// daemon can write to a temp file and pass via `--mcp-config`.
//
// SECURITY (spike G1-3-T0 §2.3): secrets ride ENV-NAME INDIRECTION only.
// Header values may reference `${ENV_VAR}`; the claude CLI expands them from
// the daemon host's environment. A literal credential must never enter this
// fragment — it would ride the Execution Payload across the trust boundary.

import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/server/utils'

export interface DaemonMcpServer {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

/**
 * The payload's `mcp` block. `configError` mirrors `session.commandError`
 * semantics: when set, the daemon must FAIL the step with the message and
 * never spawn — the agent was promised these tools, so partial or silent
 * delivery is a "silent pretend" (spike §2.4).
 */
export interface DaemonMcpFragment {
  servers: Record<string, DaemonMcpServer>
  configError: string | null
}

/** Header names that carry credentials — their values MUST use `${ENV_VAR}`. */
const AUTH_HEADER_PATTERN = /authorization|api[-_]?key|token|secret|cookie/i

const ENV_REF_PATTERN = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/

/** claude MCP server names: keep it to a conservative identifier charset. */
function sanitizeServerName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'mcp'
}

/**
 * Build the daemon Execution Payload's `mcp` block from an agent's
 * `mcpConnectionIds`. Returns null when the agent references no connections
 * (the payload field is then null — MCP simply not in play for the step).
 *
 * The lookup is PROJECT-SCOPED: a connection id referencing another project's
 * row resolves as "not found" — connection defs must not leak across projects.
 */
export async function buildDaemonMcpServers(
  mcpConnectionIds: string | null | undefined,
  projectId: string,
): Promise<DaemonMcpFragment | null> {
  const ids = mcpConnectionIds ? safeJsonParse<string[]>(mcpConnectionIds, []) : []
  if (ids.length === 0) return null

  const connections = await db.projectMcpConnection.findMany({
    where: { id: { in: ids }, projectId },
    select: { id: true, name: true, endpoint: true, config: true },
  })

  const servers: Record<string, DaemonMcpServer> = {}
  const errors: string[] = []
  const byId = new Map(connections.map(c => [c.id, c]))

  for (const id of ids) {
    const conn = byId.get(id)
    if (!conn) {
      errors.push(`MCP connection ${id} not found in this project`)
      continue
    }
    if (!conn.endpoint || !/^https?:\/\//i.test(conn.endpoint)) {
      errors.push(`MCP connection "${conn.name}" has no http(s) endpoint`)
      continue
    }

    const config = conn.config ? safeJsonParse<Record<string, unknown>>(conn.config, {}) : {}
    const rawHeaders = config.headers
    let headers: Record<string, string> | undefined
    if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
      headers = {}
      for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          errors.push(`MCP connection "${conn.name}": header "${key}" must be a string`)
          continue
        }
        // Secret guard: credential headers must be env-indirection templates.
        // A literal value here would ship a secret inside the payload.
        if (AUTH_HEADER_PATTERN.test(key) && !ENV_REF_PATTERN.test(value)) {
          errors.push(
            `MCP connection "${conn.name}": header "${key}" must reference an ` +
              'environment variable (e.g. "Bearer ${MY_TOKEN}") — secrets ride env ' +
              'indirection, never the payload',
          )
          continue
        }
        headers[key] = value
      }
      if (Object.keys(headers).length === 0) headers = undefined
    }

    let name = sanitizeServerName(conn.name)
    while (name in servers) name = `${name}-2`
    servers[name] = { type: 'http', url: conn.endpoint, ...(headers ? { headers } : {}) }
  }

  return {
    servers,
    configError: errors.length > 0 ? errors.join('; ') : null,
  }
}
