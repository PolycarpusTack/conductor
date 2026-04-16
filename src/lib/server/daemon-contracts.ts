import { z } from 'zod'

export const daemonCapabilitySchema = z.object({
  version: z.string().min(1).max(60),
  path: z.string().max(500).optional(),
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
})

export const daemonHealthSchema = z.object({
  cpuPct: z.number().min(0).max(100).optional(),
  memMb: z.number().min(0).optional(),
  runningTasks: z.number().int().min(0),
})

export const daemonEventSchema = z.discriminatedUnion('type', [
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
