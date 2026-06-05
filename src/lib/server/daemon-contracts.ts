import { z } from 'zod'

export const daemonCapabilitySchema = z.object({
  version: z.string().min(1).max(60),
  path: z.string().max(500).optional(),
})

// Optional host identity block — lets the daemon link itself to a durable
// machine record. installationId is a daemon-persisted UUID, stable across
// hostname changes; absent for legacy daemons (slug falls back to hostname).
export const registerHostSchema = z.object({
  installationId: z.string().trim().min(1).max(100).optional(),
  displayName: z.string().trim().min(1).max(255).optional(),
  hostname: z.string().trim().min(1).max(255).optional(), // defaults to daemon hostname
  arch: z.string().trim().max(40).optional(),
  labels: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  trustLevel: z.enum(['local', 'lan', 'remote', 'cloud']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const registerDaemonSchema = z.object({
  hostname: z.string().trim().min(1).max(255),
  platform: z.enum(['darwin', 'linux', 'win32']),
  version: z.string().trim().min(1).max(60),
  capabilities: z.record(
    z.enum(['claude-code', 'codex', 'copilot']),
    daemonCapabilitySchema,
  ),
  workspaceId: z.string().trim().min(1).optional(),
  host: registerHostSchema.optional(),
  // Reserved for Epic 2 (session backends) — stored, not yet read
  sessionCapabilities: z
    .object({
      backends: z.array(z.enum(['pty', 'tmux', 'process', 'container'])).max(4),
      supportsStreaming: z.boolean().optional(),
    })
    .optional(),
})

export const daemonHealthSchema = z.object({
  cpuPct: z.number().min(0).max(100).optional(),
  memMb: z.number().min(0).optional(),
  runningTasks: z.number().int().min(0),
  activeSessions: z.number().int().min(0).optional(),
})

export const SESSION_BACKENDS = ['pty', 'tmux', 'process', 'container'] as const
export const SESSION_STATUSES = ['starting', 'active', 'idle', 'waiting', 'exited', 'failed'] as const

/** Daemon upserts a session it owns; identity fields come from the token, not this payload. */
export const upsertSessionSchema = z.object({
  sessionKey: z.string().trim().min(1).max(120),
  backend: z.enum(SESSION_BACKENDS),
  cwd: z.string().trim().max(500).optional(),
  command: z.string().trim().max(500).optional(),
  agentId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  taskId: z.string().trim().min(1).optional(),
  stepId: z.string().trim().min(1).optional(),
  status: z.enum(SESSION_STATUSES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    status: z.enum(['active', 'idle', 'waiting', 'exited', 'failed']),
    reason: z.string().max(500).optional(),
    exitCode: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('output'),
    stream: z.enum(['stdout', 'stderr']),
    chunk: z.string().max(8000),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('command'),
    commandSummary: z.string().max(500),
  }),
  z.object({
    type: z.literal('metric'),
    cpuPct: z.number().min(0).max(100).optional(),
    memoryMb: z.number().min(0).optional(),
  }),
])

export type SessionEvent = z.infer<typeof sessionEventSchema>

export const liveAgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thinking') }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    ok: z.boolean(),
    output: z.string().max(5000),
    truncated: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('text'),
    chunk: z.string().max(5000),
  }),
  z.object({
    type: z.literal('completed'),
    summary: z.string().max(5000).optional(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string().max(5000),
  }),
])

/** @deprecated Use liveAgentEventSchema. Kept for one release cycle. */
export const daemonEventSchema = liveAgentEventSchema
