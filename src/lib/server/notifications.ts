import { db } from '@/lib/db'
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
import { createSmtpTransport } from '@/lib/server/email-transport'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('notifications')

// ---------------------------------------------------------------------------
// C-4 Notification center: events that need a human actually reach one.
//
// Three emit points call into this module:
//   - review_gate_waiting  a human sign-off step became active
//                          (dispatch.ts activateStep / startChain)
//   - dead_letter          a step exhausted its retries and was snapshotted
//                          into the dead-letter table (dispatch.ts)
//   - budget_exceeded      a project's dispatch was paused by its budget —
//                          once per pause episode (budget.ts)
//
// Every emit writes a Notification row and broadcasts 'notification-created'
// so the UI updates live; when SMTP is configured (see getEmailConfig) a
// plain-text email is also sent, fire-and-forget.
//
// NOTHING in this module ever throws — a broken notification path must never
// take dispatch or the budget check down with it.
// ---------------------------------------------------------------------------

export type NotificationType = 'review_gate_waiting' | 'dead_letter' | 'budget_exceeded'

export interface NotificationInput {
  projectId: string
  type: NotificationType
  title: string
  body?: string | null
  taskId?: string | null
}

// ---------------------------------------------------------------------------
// Test seam (same pattern as dispatchDeps in dispatch.ts): the SMTP transport
// factory is resolved through this mutable indirection so tests can observe
// send attempts without touching the network or bun's shared module registry.
// ---------------------------------------------------------------------------
export const notificationDeps = {
  createSmtpTransport,
}

export function setNotificationDeps(overrides: Partial<typeof notificationDeps>): void {
  Object.assign(notificationDeps, overrides)
}

export function resetNotificationDeps(): void {
  notificationDeps.createSmtpTransport = createSmtpTransport
}

/**
 * Creates the in-app notification, broadcasts it to the board, and (when
 * configured) fires the email. Never throws; on a failed write nothing is
 * broadcast or emailed (no ghost notifications).
 */
export async function createNotification(input: NotificationInput): Promise<void> {
  let row: { id: string; createdAt: Date }
  try {
    row = await db.notification.create({
      data: {
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        taskId: input.taskId ?? null,
      },
    })
  } catch (err) {
    log.warn(`failed to create ${input.type} notification: ${String(err)}`)
    return
  }

  try {
    await broadcastProjectEvent(input.projectId, 'notification-created', {
      notification: {
        id: row.id,
        projectId: input.projectId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        taskId: input.taskId ?? null,
        readAt: null,
        createdAt: row.createdAt,
      },
    })
  } catch (err) {
    log.warn(`failed to broadcast notification-created: ${String(err)}`)
  }

  // Fire-and-forget: the caller (dispatch/budget hot paths) must not wait on SMTP.
  void sendNotificationEmail(input.type, input.title, input.body ?? null)
}

// ---------------------------------------------------------------------------
// Emit helpers — one per event type, tailored titles/bodies, never throw.
// ---------------------------------------------------------------------------

/** A human sign-off step became active — someone needs to review. */
export async function notifyReviewGateWaiting(opts: {
  projectId: string
  taskId: string
  stepId: string
  humanLabel?: string | null
}): Promise<void> {
  try {
    const task = await db.task.findUnique({
      where: { id: opts.taskId },
      select: { title: true },
    })
    await createNotification({
      projectId: opts.projectId,
      type: 'review_gate_waiting',
      title: `Review needed: ${task?.title ?? 'a task'}`,
      body: `"${opts.humanLabel || 'Human step'}" is waiting for human sign-off.`,
      taskId: opts.taskId,
    })
  } catch (err) {
    log.warn(`review-gate notification failed for step ${opts.stepId}: ${String(err)}`)
  }
}

/** A step exhausted its retries (and any fallback agent) and was dead-lettered. */
export async function notifyDeadLetter(opts: {
  projectId: string
  taskId: string
  taskTitle?: string | null
  stepId: string
  error: string
}): Promise<void> {
  try {
    await createNotification({
      projectId: opts.projectId,
      type: 'dead_letter',
      title: `Step dead-lettered: ${opts.taskTitle ?? 'a task'}`,
      body: `A step failed all retries and needs triage. Last error: ${opts.error}`,
      taskId: opts.taskId,
    })
  } catch (err) {
    log.warn(`dead-letter notification failed for step ${opts.stepId}: ${String(err)}`)
  }
}

/** Dispatch paused by the project budget — called once per pause episode. */
export async function notifyBudgetExceeded(opts: {
  projectId: string
  budgetUsd: number
  spentUsd: number
}): Promise<void> {
  try {
    await createNotification({
      projectId: opts.projectId,
      type: 'budget_exceeded',
      title: 'Budget exceeded — dispatch paused',
      body: `Month-to-date spend $${opts.spentUsd} has reached the $${opts.budgetUsd} budget. Raise the budget to resume dispatch.`,
    })
  } catch (err) {
    log.warn(`budget notification failed for project ${opts.projectId}: ${String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Optional email delivery. Per-instance opt-in via env: SMTP_HOST +
// NOTIFY_EMAIL_TO enable it (SMTP_PORT/SMTP_USER/SMTP_PASS/NOTIFY_EMAIL_FROM
// optional). Unconfigured instances skip silently — in-app still works.
// ---------------------------------------------------------------------------

function getEmailConfig() {
  const host = process.env.SMTP_HOST
  const to = process.env.NOTIFY_EMAIL_TO
  if (!host || !to) return null
  const user = process.env.SMTP_USER
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? '587'),
    user,
    pass: process.env.SMTP_PASS,
    from: process.env.NOTIFY_EMAIL_FROM || user || 'agentboard@localhost',
    to,
  }
}

/** Plain-text email for a notification. Never throws; failures are logged. */
export async function sendNotificationEmail(
  type: NotificationType,
  title: string,
  body: string | null,
): Promise<void> {
  const config = getEmailConfig()
  if (!config) return // not configured on this instance — in-app only

  try {
    const transport = notificationDeps.createSmtpTransport({
      host: config.host,
      port: config.port,
      user: config.user,
      pass: config.pass,
    })
    await transport.sendMail({
      from: config.from,
      to: config.to,
      subject: `[AgentBoard] ${title}`,
      text: body || title,
    })
  } catch (err) {
    log.warn(`notification email (${type}) failed: ${String(err)}`)
  }
}
