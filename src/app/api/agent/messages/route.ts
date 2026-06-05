import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import {
  ensureAgentAddress,
  presentBody,
  resolveRecipientByAddress,
  sendMessage,
} from '@/lib/server/agent-messaging'
import { badRequest, forbidden, notFound, unauthorized, withErrorHandling } from '@/lib/server/api-errors'
import { extractAgentApiKey, resolveAgentByApiKey } from '@/lib/server/api-keys'

const sendSchema = z.object({
  to: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(20_000),
  subject: z.string().trim().max(200).optional(),
  taskId: z.string().trim().min(1).optional(),
  stepId: z.string().trim().min(1).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  threadId: z.string().trim().min(1).optional(),
})

/**
 * GET /api/agent/messages?status= — the authenticated agent's inbox.
 * Returned `queued` messages auto-transition to `delivered`; flagged bodies
 * are wrapped as data at delivery (the stored original stays intact).
 */
export const GET = withErrorHandling('api/agent/messages', async (request: Request) => {
  const rawKey = extractAgentApiKey(request)
  if (!rawKey) throw unauthorized('Missing API key')

  const agent = await resolveAgentByApiKey(rawKey)
  if (!agent) throw unauthorized('Invalid API key')

  const status = new URL(request.url).searchParams.get('status')

  const messages = await db.agentMessage.findMany({
    where: {
      projectId: agent.projectId,
      toAgentId: agent.id,
      ...(status ? { status } : { status: { not: 'archived' } }),
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  // Auto-deliver: receiving the inbox IS delivery
  const queuedIds = messages.filter((m) => m.status === 'queued').map((m) => m.id)
  if (queuedIds.length > 0) {
    await db.agentMessage.updateMany({
      where: { id: { in: queuedIds } },
      data: { status: 'delivered', deliveredAt: new Date() },
    })
  }

  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      taskId: m.taskId,
      stepId: m.stepId,
      from: m.fromAddress,
      to: m.toAddress,
      priority: m.priority,
      subject: m.subject,
      body: presentBody(m),
      status: queuedIds.includes(m.id) ? 'delivered' : m.status,
      createdAt: m.createdAt,
      readAt: m.readAt,
    })),
  })
})

/** POST /api/agent/messages — authenticated agent sends to a same-project address. */
export const POST = withErrorHandling('api/agent/messages', async (request: Request) => {
  const rawKey = extractAgentApiKey(request)
  if (!rawKey) throw unauthorized('Missing API key')

  const agent = await resolveAgentByApiKey(rawKey)
  if (!agent) throw unauthorized('Invalid API key')

  const parsed = sendSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid message payload')
  }
  const input = parsed.data

  const recipient = await resolveRecipientByAddress(agent.projectId, input.to)
  if (!recipient) throw notFound(`No active address "${input.to}" in this project`)

  if (input.taskId) {
    const task = await db.task.findUnique({
      where: { id: input.taskId },
      select: { projectId: true },
    })
    if (!task) throw notFound('Task not found')
    if (task.projectId !== agent.projectId) {
      throw forbidden("Task does not belong to this agent's project")
    }
  }

  const fromAddress = await ensureAgentAddress(agent.id, agent.projectId, agent.name)

  const message = await sendMessage({
    projectId: agent.projectId,
    fromAgentId: agent.id,
    fromAddress,
    toAgentId: recipient.agentId,
    toAddress: input.to.trim().toLowerCase(),
    body: input.body,
    subject: input.subject,
    taskId: input.taskId,
    stepId: input.stepId,
    threadId: input.threadId,
    priority: input.priority,
    trust: 'agent',
  })

  return NextResponse.json({ messageId: message.id, threadId: message.threadId }, { status: 201 })
})
