import type { SessionEvent } from '@/lib/server/daemon-contracts'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * Pure helpers for daemon-reported execution sessions. Sessions store only a
 * redacted, bounded output tail — durable results belong to executions and
 * artifacts (roadmap decision D3).
 */

export const MAX_OUTPUT_PREVIEW_CHARS = 5000

/** Appends a chunk and keeps only the last MAX_OUTPUT_PREVIEW_CHARS. */
export function appendOutputPreview(existing: string | null | undefined, chunk: string): string {
  const combined = (existing ?? '') + chunk
  return combined.length > MAX_OUTPUT_PREVIEW_CHARS
    ? combined.slice(-MAX_OUTPUT_PREVIEW_CHARS)
    : combined
}

const REDACTION_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // Structured app keys: cd_daemon.<id>.<secret>, ab_agent.<id>.<secret>, ab_project...
  /\b(?:cd_daemon|ab_agent|ab_project)\.[A-Za-z0-9-]+\.[A-Za-z0-9]+/g,
  // OpenAI-style keys
  /\bsk-[A-Za-z0-9-]{12,}/g,
  // KEY=value pairs with secret-looking names
  /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_?KEY)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi,
]

/** Masks common credential shapes in terminal output before persistence/broadcast. */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of REDACTION_PATTERNS) {
    result = result.replace(pattern, (match, name?: string) =>
      typeof name === 'string' && match.includes('=') ? `${name}=[REDACTED]` : '[REDACTED]',
    )
  }
  return result
}

const TERMINAL_STATUSES = new Set(['exited', 'failed'])

interface SessionSnapshot {
  status: string
  outputPreview: string | null
  command: string | null
  metadata: string | null
  endedAt: Date | null
  exitCode: number | null
}

export interface SessionPatch {
  status?: string
  outputPreview?: string
  command?: string
  metadata?: string
  lastActivityAt?: Date
  endedAt?: Date
  exitCode?: number
}

/**
 * Translates a daemon session event into a DB patch. Pure — caller persists.
 * Terminal statuses are sticky: late output flushes append to the preview but
 * never resurrect the status.
 */
export function applySessionEvent(session: SessionSnapshot, event: SessionEvent): SessionPatch {
  const now = new Date()

  switch (event.type) {
    case 'status': {
      const patch: SessionPatch = { status: event.status, lastActivityAt: now }
      if (TERMINAL_STATUSES.has(event.status)) {
        patch.endedAt = now
        if (event.exitCode !== undefined) patch.exitCode = event.exitCode
      }
      return patch
    }

    case 'output': {
      const patch: SessionPatch = {
        outputPreview: appendOutputPreview(session.outputPreview, redactSecrets(event.chunk)),
        lastActivityAt: now,
      }
      // Sticky terminal status; otherwise output implies the session is active
      if (!TERMINAL_STATUSES.has(session.status) && session.status !== 'active') {
        patch.status = 'active'
      }
      return patch
    }

    case 'command':
      return { command: event.commandSummary, lastActivityAt: now }

    case 'metric': {
      const existing = safeJsonParse<Record<string, unknown>>(session.metadata, {})
      return {
        metadata: JSON.stringify({
          ...existing,
          metrics: { cpuPct: event.cpuPct, memoryMb: event.memoryMb },
          metricsAt: now.toISOString(),
        }),
      }
    }
  }
}
