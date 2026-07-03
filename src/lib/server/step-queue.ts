import { db } from '@/lib/db'
import { filterBudgetPausedProjects } from '@/lib/server/budget'
import { sweepStaleDaemonsThrottled } from '@/lib/server/daemon-auth'
import { dispatchStepToDaemon } from '@/lib/server/daemon-dispatch'
import { dispatchStep } from '@/lib/server/dispatch'
import { safeJsonParse } from '@/lib/server/utils'

// Exported so dispatchers can steal leases older than this threshold when
// a worker or daemon has died mid-step. Both the HTTP and daemon paths must
// agree on this value — otherwise the queue surfaces a reclaimable step that
// the dispatcher still refuses to take, and work gets stuck.
export const LEASE_TIMEOUT_MS = 600000 // 10 min
const POLL_BATCH_SIZE = 5

export async function pollAndDispatch(projectId?: string) {
  // Flip dead daemons to 'stale' before dispatching, so DAEMON-mode steps
  // aren't leased to a daemon that has stopped heartbeating. Throttled
  // internally — safe to call on every tick.
  await sweepStaleDaemonsThrottled()

  const now = new Date()
  const leaseExpiry = new Date(now.getTime() - LEASE_TIMEOUT_MS)

  // Optional project scope — when called from a project-specific scheduler,
  // only dispatch steps belonging to that project. Soft-deleted tasks never
  // dispatch (Epic S3).
  const projectFilter = { task: { deletedAt: null, ...(projectId ? { projectId } : {}) } }

  // Find steps that are active and either:
  // 1. Not leased and not delayed (leasedAt is null or in the past)
  // 2. Lease expired (leasedAt < expiry threshold and leasedBy is set)
  const steps = await db.taskStep.findMany({
    where: {
      status: 'active',
      // D-4: paused agents (isActive=false) must not dispatch. This is the
      // teeth behind the pause toggle — without it, pausing an agent changed
      // only the UI while the dispatcher kept leasing and running its steps.
      agent: { runtimeId: { not: null }, isActive: true },
      mode: { not: 'human' },
      ...projectFilter,
      OR: [
        {
          leasedBy: null,
          OR: [
            { leasedAt: null },
            { leasedAt: { lte: now } },
          ],
        },
        {
          leasedBy: { not: null },
          leasedAt: { lt: leaseExpiry },
        },
      ],
    },
    select: {
      id: true,
      agent: { select: { invocationMode: true } },
      task: { select: { projectId: true } },
    },
    take: POLL_BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  })

  // Also find throttled steps: pending steps that were demoted due to agent concurrency
  // limits. Re-activate them so dispatchStep can attempt them (it will re-check concurrency).
  const throttledSteps = await db.taskStep.findMany({
    where: {
      status: 'pending',
      // D-4: a paused agent's throttled steps stay parked too — don't
      // re-activate work we're then obligated to skip.
      agent: { runtimeId: { not: null }, isActive: true },
      mode: { not: 'human' },
      task: { status: 'IN_PROGRESS', deletedAt: null, ...(projectId ? { projectId } : {}) },
    },
    select: {
      id: true,
      taskId: true,
      order: true,
      prevSteps: true,
      isMergePoint: true,
      agent: { select: { invocationMode: true } },
      task: { select: { projectId: true } },
    },
    take: POLL_BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  })

  // Re-activate throttled steps whose predecessors are all complete
  for (const throttled of throttledSteps) {
    const prevStepIds: string[] = safeJsonParse(throttled.prevSteps, [])

    if (prevStepIds.length > 0) {
      // DAG mode: check all prevSteps are done/skipped
      const prevSteps = await db.taskStep.findMany({
        where: { id: { in: prevStepIds } },
        select: { status: true },
      })
      const allPrevDone = prevSteps.length === prevStepIds.length &&
        prevSteps.every(s => s.status === 'done' || s.status === 'skipped')
      if (allPrevDone) {
        await db.taskStep.updateMany({
          where: { id: throttled.id, status: 'pending' },
          data: { status: 'active' },
        })
      }
    } else if (throttled.isMergePoint) {
      // Merge point with no prevSteps set — don't auto-activate,
      // let advanceChainDag handle it when branches complete
      continue
    } else if (throttled.order <= 1) {
      // Linear mode: first step — should be active
      await db.taskStep.updateMany({
        where: { id: throttled.id, status: 'pending' },
        data: { status: 'active' },
      })
    } else {
      // Linear mode: check predecessor by order
      const prevStep = await db.taskStep.findFirst({
        where: { taskId: throttled.taskId, order: throttled.order - 1 },
        select: { status: true },
      })
      if (prevStep && (prevStep.status === 'done' || prevStep.status === 'skipped')) {
        await db.taskStep.updateMany({
          where: { id: throttled.id, status: 'pending' },
          data: { status: 'active' },
        })
      }
    }
  }

  const allSteps = [...steps, ...throttledSteps.filter(t => {
    // Only include throttled steps that we just reactivated
    return !steps.some(s => s.id === t.id)
  })]

  if (allSteps.length === 0) return { polled: 0, succeeded: 0, failed: 0 }

  // B-7 spend budgets: projects whose month-to-date recorded cost has
  // reached Project.budgetUsd are skipped entirely (HTTP and daemon paths
  // alike). Skipped steps stay active and unleased, so dispatch resumes
  // automatically on the first tick after the budget is raised or the UTC
  // month rolls over. Projects without a budget never reach the spend query.
  const pausedProjects = await filterBudgetPausedProjects(
    [...new Set(allSteps.map(step => step.task.projectId))],
  )
  const dispatchable = pausedProjects.size > 0
    ? allSteps.filter(step => !pausedProjects.has(step.task.projectId))
    : allSteps

  // Route each step by its agent's invocationMode.
  // HTTP: the Next server executes via provider SDKs.
  // DAEMON: lease the step to an online daemon; the daemon pulls and runs.
  const results = await Promise.allSettled(
    dispatchable.map(step =>
      step.agent?.invocationMode === 'DAEMON'
        ? dispatchStepToDaemon(step.id)
        : dispatchStep(step.id),
    ),
  )

  return {
    polled: dispatchable.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}
