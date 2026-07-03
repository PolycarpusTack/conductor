import { NextResponse } from 'next/server'
import { z } from 'zod'

import { db } from '@/lib/db'
import { assertKeyProjectAccess, authorizeAdminOrScopedKey } from '@/lib/server/api-auth'
import { badRequest, withErrorHandling } from '@/lib/server/api-errors'
import { taskStatusSchema } from '@/lib/server/contracts'
import { startChain } from '@/lib/server/dispatch'
import { getLogger } from '@/lib/server/logger'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

const log = getLogger('api/tasks/batch')

/**
 * D-3: bulk task operations. One request mutates many tasks so the board can
 * be cleared fast. `move` requires a target status; `archive`/`delete` don't.
 * Capped at 200 ids per call to bound the transaction.
 */
const batchSchema = z
  .object({
    action: z.enum(['move', 'archive', 'delete']),
    taskIds: z.array(z.string().trim().min(1)).min(1, 'taskIds must not be empty').max(200),
    status: taskStatusSchema.optional(),
  })
  .refine((v) => v.action !== 'move' || v.status !== undefined, {
    message: 'A target status is required for the move action',
    path: ['status'],
  })

/**
 * POST /api/tasks/batch — move / archive / soft-delete a set of tasks in one
 * transaction. Auth: admin session (+ CSRF) OR a scoped "write" key; a
 * project-bound key may only touch its own project (B-4). All ids must belong
 * to ONE project — cross-project batches are rejected before any write.
 *
 * Idempotent per id: an already-deleted/archived task, a move that is already
 * at the target status, and an unknown id are all reported as `skipped`, never
 * an error. `affected` lists the ids actually mutated.
 */
export const POST = withErrorHandling('api/tasks/batch', async (request: Request) => {
  const auth = await authorizeAdminOrScopedKey(request, 'write')
  if (!auth.ok) return auth.response

  const parsed = batchSchema.safeParse(await request.json())
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message || 'Invalid batch payload')
  }
  const { action, status } = parsed.data
  // De-dupe ids so a repeated id can't be counted twice.
  const taskIds = [...new Set(parsed.data.taskIds)]

  // Load every referenced task once (including soft-deleted/archived so we can
  // report them as no-ops rather than "not found").
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, projectId: true, status: true, deletedAt: true, archivedAt: true },
  })

  // Reject cross-project batches — a batch is scoped to a single project so it
  // can't fan a scoped key's authority across projects, and so realtime events
  // target one channel.
  const projectIds = [...new Set(tasks.map((t) => t.projectId))]
  if (projectIds.length > 1) {
    throw badRequest('All tasks in a batch must belong to the same project')
  }
  const projectId = projectIds[0] ?? null

  // Project-scoped keys (B-4): enforce the binding against the resolved project.
  if (projectId) assertKeyProjectAccess(auth, projectId)

  const byId = new Map(tasks.map((t) => [t.id, t]))

  // Partition requested ids into "mutate" vs "skip" per action semantics.
  const affected: string[] = []
  const skipped: string[] = []
  for (const id of taskIds) {
    const task = byId.get(id)
    if (!task) {
      skipped.push(id)
      continue
    }
    if (action === 'delete') {
      if (task.deletedAt) skipped.push(id)
      else affected.push(id)
    } else if (action === 'archive') {
      // A soft-deleted task isn't a live board task; leave it to the delete flow.
      if (task.archivedAt || task.deletedAt) skipped.push(id)
      else affected.push(id)
    } else {
      // move
      if (task.deletedAt || task.archivedAt || task.status === status) skipped.push(id)
      else affected.push(id)
    }
  }

  // Perform the mutation in a single transaction, structured per action.
  if (affected.length > 0) {
    await db.$transaction(async (tx) => {
      if (action === 'delete') {
        // Mirror the single-delete route: soft delete + release step leases so
        // any in-flight pickup stops immediately.
        await tx.task.updateMany({
          where: { id: { in: affected } },
          data: { deletedAt: new Date() },
        })
        await tx.taskStep.updateMany({
          where: { taskId: { in: affected } },
          data: { leasedBy: null, leasedAt: null },
        })
      } else if (action === 'archive') {
        await tx.task.updateMany({
          where: { id: { in: affected } },
          data: { archivedAt: new Date() },
        })
      } else {
        await tx.task.updateMany({
          where: { id: { in: affected } },
          data: { status },
        })
      }
    })
  }

  // For move, return the refreshed tasks so the client reconciles statuses;
  // delete/archive just need the id list (the client drops them).
  let movedTasks: unknown[] = []
  if (action === 'move' && affected.length > 0) {
    movedTasks = await db.task.findMany({
      where: { id: { in: affected } },
      include: taskBoardInclude,
    })
  }

  // Best-effort realtime + chain side effects (never fail the request on these).
  if (projectId && affected.length > 0) {
    const event = action === 'move' ? 'task-moved' : 'task-deleted'
    for (const id of affected) {
      void broadcastProjectEvent(projectId, event, action === 'move' ? { taskId: id } : id)
    }
    // Mirror the single PUT: a task moved to IN_PROGRESS with untouched steps
    // starts its chain, so a bulk move doesn't leave chain tasks inert.
    if (action === 'move' && status === 'IN_PROGRESS') {
      const withSteps = await db.task.findMany({
        where: { id: { in: affected } },
        select: { id: true, steps: { select: { status: true } } },
      })
      for (const t of withSteps) {
        if (t.steps.length === 0) continue
        const hasActive = t.steps.some((s) => s.status === 'active')
        const hasProgress = t.steps.some((s) => s.status === 'done' || s.status === 'skipped')
        if (hasActive || hasProgress) continue
        try {
          await startChain(t.id, projectId)
        } catch (err) {
          log.error('startChain failed during batch move', err, { taskId: t.id })
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    action,
    ...(action === 'move' ? { status } : {}),
    affected,
    skipped,
    tasks: movedTasks,
  })
})
