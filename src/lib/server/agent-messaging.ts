import { db } from '@/lib/db'
import {
  scanForPromptInjection,
  wrapExternalContent,
  type ContentSafetyFlag,
  type ContentTrust,
} from '@/lib/server/content-safety'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * Project-scoped agent messaging. Bodies are stored as written; the
 * content-safety verdict is stamped into `bodySecurity` at send time and
 * flagged bodies are wrapped at DELIVERY (presentBody) so the stored
 * original stays intact for admin forensics.
 */

export const ADMIN_ADDRESS = 'admin@conductor'

export interface BodySecurity {
  trust: ContentTrust
  flags: ContentSafetyFlag[]
}

/** Stable, human-readable address slug from an agent name. */
export function slugifyAddress(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  )
}

/** Upserts the agent's address within its project; returns the address string. */
export async function ensureAgentAddress(
  agentId: string,
  projectId: string,
  agentName: string,
): Promise<string> {
  const address = slugifyAddress(agentName)
  await db.agentAddress.upsert({
    where: { projectId_address: { projectId, address } },
    create: { agentId, projectId, address },
    update: { agentId, active: true },
  })
  return address
}

/** Resolves an active address to its agent within the SAME project only. */
export async function resolveRecipientByAddress(
  projectId: string,
  address: string,
): Promise<{ agentId: string } | null> {
  const record = await db.agentAddress.findUnique({
    where: { projectId_address: { projectId, address: address.trim().toLowerCase() } },
    select: { agentId: true, active: true },
  })
  if (!record || !record.active) return null
  return { agentId: record.agentId }
}

export interface SendMessageInput {
  projectId: string
  fromAgentId?: string | null
  fromAddress: string
  toAgentId: string
  toAddress: string
  body: string
  subject?: string | null
  taskId?: string | null
  stepId?: string | null
  threadId?: string | null
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  trust: ContentTrust
}

/**
 * Persists a message (status `queued`) with its content-safety verdict and
 * broadcasts `agent-message-created`. threadId defaults to the message's own
 * id so every message roots a thread.
 */
export async function sendMessage(input: SendMessageInput) {
  const flags = scanForPromptInjection(input.body)
  const bodySecurity: BodySecurity = { trust: input.trust, flags }

  const message = await db.agentMessage.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      stepId: input.stepId ?? null,
      threadId: input.threadId ?? null,
      fromAgentId: input.fromAgentId ?? null,
      toAgentId: input.toAgentId,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      priority: input.priority ?? 'normal',
      subject: input.subject ?? null,
      body: input.body,
      bodySecurity: JSON.stringify(bodySecurity),
    },
  })

  if (!message.threadId) {
    await db.agentMessage.update({ where: { id: message.id }, data: { threadId: message.id } })
    message.threadId = message.id
  }

  broadcastProjectEvent(input.projectId, 'agent-message-created', {
    messageId: message.id,
    projectId: input.projectId,
    taskId: message.taskId,
    fromAgentId: message.fromAgentId,
    toAgentId: message.toAgentId,
    toAddress: message.toAddress,
    priority: message.priority,
    flagged: flags.length > 0,
    timestamp: message.createdAt.toISOString(),
  })

  return message
}

const TRUSTED: ReadonlySet<string> = new Set(['admin', 'system'])

/**
 * Delivery-time body presentation: flagged content from non-trusted senders
 * is wrapped as data; everything else is returned verbatim.
 */
export function presentBody(message: {
  body: string
  fromAddress: string
  bodySecurity: string | null
}): string {
  const security = safeJsonParse<Partial<BodySecurity>>(message.bodySecurity, {})
  const flags = security.flags ?? []
  const trust = security.trust ?? 'unknown'

  if (flags.length === 0 || TRUSTED.has(trust)) return message.body

  return wrapExternalContent({
    text: message.body,
    source: 'agent-message',
    sender: message.fromAddress,
    trust,
  }).text
}
