import { z } from 'zod'

import { safeJsonParse } from '@/lib/server/utils'

/**
 * Session execution policy for daemon-mode steps, declared on
 * `ProjectRuntime.config` alongside other runtime settings. Parsing is
 * deliberately lenient: any invalid or missing field degrades to a safe
 * default — a broken config must never block dispatch.
 */

export const SESSION_POLICIES = ['ephemeral', 'persistent-agent', 'persistent-task', 'persistent-step'] as const
export type SessionPolicyKind = (typeof SESSION_POLICIES)[number]

const sessionPolicySchema = z.object({
  sessionPolicy: z.enum(SESSION_POLICIES).catch('ephemeral'),
  sessionBackend: z.enum(['pty', 'tmux', 'process', 'container']).catch('process'),
  commandTemplate: z.string().min(1).max(500).nullish().catch(null),
  workingDirectoryPolicy: z.enum(['project-root', 'task-dir', 'daemon-default']).catch('daemon-default'),
  idleRequiredBeforeCommand: z.boolean().catch(false),
  maxOutputPreviewChars: z.number().int().min(100).max(50_000).catch(5000),
})

export type SessionPolicy = z.infer<typeof sessionPolicySchema>

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  sessionPolicy: 'ephemeral',
  sessionBackend: 'process',
  commandTemplate: null,
  workingDirectoryPolicy: 'daemon-default',
  idleRequiredBeforeCommand: false,
  maxOutputPreviewChars: 5000,
}

/** Parses the session policy out of a runtime's `config` JSON string. */
export function parseSessionPolicy(runtimeConfig: string | null | undefined): SessionPolicy {
  const raw = safeJsonParse<Record<string, unknown>>(runtimeConfig ?? null, {})
  const parsed = sessionPolicySchema.safeParse(raw)
  if (parsed.success) {
    return { ...parsed.data, commandTemplate: parsed.data.commandTemplate ?? null }
  }
  return DEFAULT_SESSION_POLICY
}

export interface SessionKeyIds {
  agentId?: string | null
  taskId?: string | null
  stepId: string
}

/**
 * Server-computed session key — reuse semantics live here, not in daemons.
 * Combined with the (daemonId, sessionKey) unique constraint, a persistent
 * policy makes the daemon's upsert naturally reuse the same session row.
 */
export function sessionKeyForStep(policy: SessionPolicy, ids: SessionKeyIds): string {
  switch (policy.sessionPolicy) {
    case 'persistent-agent':
      return ids.agentId ? `agent-${ids.agentId}` : `step-${ids.stepId}`
    case 'persistent-task':
      return ids.taskId ? `task-${ids.taskId}` : `step-${ids.stepId}`
    case 'persistent-step':
    case 'ephemeral':
      return `step-${ids.stepId}`
  }
}

/** Substitutes `{{token}}` placeholders; unknown tokens become empty strings. */
export function resolveCommandTemplate(
  template: string | null | undefined,
  vars: Record<string, string | null | undefined>,
): string | null {
  if (!template) return null
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, token: string) => vars[token] ?? '')
}
