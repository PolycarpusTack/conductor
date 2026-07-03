import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { notifyTaskOverdue } from '@/lib/server/notifications'

const log = getLogger('overdue-reminders')

/**
 * Overdue-reminder sweep (D-2-T2).
 *
 * Finds tasks that are past their due date and not yet done, and emits ONE
 * `task_overdue` notification per task. Runs from the scheduler's global tick
 * beside the claim reaper and automation sweeps.
 *
 * Dedupe / race tolerance:
 * - Candidates are read with `dueReminderSentAt: null`, then each emit is
 *   gated behind a guarded compare-and-set (`updateMany where id +
 *   dueReminderSentAt: null → set dueReminderSentAt: now`). Only the writer
 *   that flips NULL→now (count === 1) emits, so a re-run — or a concurrent
 *   tick — never double-notifies. This mirrors the claim reaper's guarded
 *   write and is the simplest exactly-once approach: the stamp is the dedupe
 *   key, so there is no notification-table read/TOCTOU window.
 *
 * Scope guards:
 * - `dueDate < now` (strict): a task due exactly now is not yet overdue.
 * - `status: { not: 'DONE' }`: a completed task is never reminded.
 * - `deletedAt` / `archivedAt` null: soft-deleted and archived tasks excluded.
 *
 * Returns the number of reminders emitted.
 */
export async function runOverdueReminders(): Promise<number> {
  const now = new Date()

  const candidates = await db.task.findMany({
    where: {
      status: { not: 'DONE' },
      deletedAt: null,
      archivedAt: null,
      dueDate: { not: null, lt: now },
      dueReminderSentAt: null,
    },
    select: {
      id: true,
      projectId: true,
      title: true,
      dueDate: true,
    },
  })

  let emitted = 0

  for (const task of candidates) {
    // Guarded compare-and-set: only the writer that flips NULL→now proceeds.
    const claimed = await db.task.updateMany({
      where: { id: task.id, dueReminderSentAt: null },
      data: { dueReminderSentAt: now },
    })
    if (claimed.count === 0) continue // another tick already reminded

    emitted++

    // notifyTaskOverdue is throw-proof; task.dueDate is non-null by the query.
    await notifyTaskOverdue({
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      dueDate: task.dueDate as Date,
    })

    log.info('emitted overdue reminder', { taskId: task.id, projectId: task.projectId })
  }

  return emitted
}
