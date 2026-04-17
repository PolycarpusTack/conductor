import { db } from '@/lib/db'
import { dispatchStepToDaemon } from '@/lib/server/daemon-dispatch'
import { dispatchStep } from '@/lib/server/dispatch'

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const LEASE_TIMEOUT_MS = 600000 // 10 min — if a worker hasn't finished, assume it died
const POLL_BATCH_SIZE = 5

export async function pollAndDispatch(projectId?: string) {
  const now = new Date()
  const leaseExpiry = new Date(now.getTime() - LEASE_TIMEOUT_MS)

  // Optional project scope — when called from a project-specific scheduler,
  // only dispatch steps belonging to that project.
  const projectFilter = projectId ? { task: { projectId } } : {}

  // Find steps that are active and either:
  // 1. Not leased and not delayed (leasedAt is null or in the past)
  // 2. Lease expired (leasedAt < expiry threshold and leasedBy is set)
  const steps = await db.taskStep.findMany({
    where: {
      status: 'active',
      agent: { runtimeId: { not: null } },
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
    },
    take: POLL_BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  })

  // Also find throttled steps: pending steps that were demoted due to agent concurrency
  // limits. Re-activate them so dispatchStep can attempt them (it will re-check concurrency).
  const throttledSteps = await db.taskStep.findMany({
    where: {
      status: 'pending',
      agent: { runtimeId: { not: null } },
      mode: { not: 'human' },
      task: { status: 'IN_PROGRESS', ...(projectId ? { projectId } : {}) },
    },
    select: {
      id: true,
      taskId: true,
      order: true,
      prevSteps: true,
      isMergePoint: true,
      agent: { select: { invocationMode: true } },
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

  // Route each step by its agent's invocationMode.
  // HTTP: the Next server executes via provider SDKs.
  // DAEMON: lease the step to an online daemon; the daemon pulls and runs.
  const results = await Promise.allSettled(
    allSteps.map(step =>
      step.agent?.invocationMode === 'DAEMON'
        ? dispatchStepToDaemon(step.id)
        : dispatchStep(step.id),
    ),
  )

  return {
    polled: allSteps.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}
