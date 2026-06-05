import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import {
  ADMIN_ADDRESS,
  resolveRecipientByAddress,
  sendMessage,
} from '@/lib/server/agent-messaging'
import { assertSameOrigin } from '@/lib/csrf'
import { requireAdminSession } from '@/lib/server/admin-session'
import { badRequest, notFound, withErrorHandling } from '@/lib/server/api-errors'
import { safeJsonParse } from '@/lib/server/utils'

const adminSendSchema = z.object({
  to: z.string().trim().min(1).max(120),
  body: z.string().min(1).max(20_000),
  subject: z.string().trim().max(200).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  threadId: z.string().trim().min(1).optional(),
})

/**
 * GET /api/tasks/[id]/messages — the task's message thread for admins.
 * Bodies are returned RAW with their security verdicts — this is the
 * forensics view; delivery-time wrapping applies only to agent reads.
 */
export const GET = withErrorHandling(
  'api/tasks/[id]/messages',
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized

    const { id } = await params
    const task = await db.task.findUnique({ where: { id }, select: { id: true } })
    if (!task) throw notFound('Task not found')

    const messages = await db.agentMessage.findMany({
      where: { taskId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    return NextResponse.json({
      messages: messages.map((m) => ({
        ...m,
        bodySecurity: safeJsonParse<Record<string, unknown> | null>(m.bodySecurity, null),
      })),
    })
  },
)

/** POST /api/tasks/[id]/messages — admin sends into the task thread. */
export const POST = withErrorHandling(
  'api/tasks/[id]/messages',
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const unauthorized = await requireAdminSession()
    if (unauthorized) return unauthorized
    assertSameOrigin(request)

    const { id } = await params
    const task = await db.task.findUnique({ where: { id }, select: { projectId: true } })
    if (!task) throw notFound('Task not found')

    const parsed = adminSendSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message || 'Invalid message payload')
    }
    const input = parsed.data

    const recipient = await resolveRecipientByAddress(task.projectId, input.to)
    if (!recipient) throw notFound(`No active address "${input.to}" in this project`)

    const message = await sendMessage({
      projectId: task.projectId,
      fromAgentId: null,
      fromAddress: ADMIN_ADDRESS,
      toAgentId: recipient.agentId,
      toAddress: input.to.trim().toLowerCase(),
      body: input.body,
      subject: input.subject,
      taskId: id,
      threadId: input.threadId,
      priority: input.priority,
      trust: 'admin',
    })

    return NextResponse.json({ messageId: message.id, threadId: message.threadId }, { status: 201 })
  },
)
