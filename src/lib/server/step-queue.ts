import { db } from '@/lib/db'
import { dispatchStep } from '@/lib/server/dispatch'

const LEASE_TIMEOUT_MS = 600000 // 10 min — if a worker hasn't finished, assume it died
const POLL_BATCH_SIZE = 5

export async function pollAndDispatch() {
  const now = new Date()
  const leaseExpiry = new Date(now.getTime() - LEASE_TIMEOUT_MS)

  // Find steps that are active and either:
  // 1. Not leased and not delayed (leasedAt is null or in the past)
  // 2. Lease expired (leasedAt < expiry threshold and leasedBy is set)
  const steps = await db.taskStep.findMany({
    where: {
      status: 'active',
      agent: { runtimeId: { not: null } },
      mode: { not: 'human' },
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
    select: { id: true },
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
      task: { status: 'IN_PROGRESS' },
      // Only pick up steps whose predecessor is done (their turn has come)
      // We detect this by checking order > 0 and the previous step is done/skipped,
      // or order === 1 (first step that was throttled).
    },
    select: { id: true, taskId: true, order: true },
    take: POLL_BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  })

  // Re-activate throttled steps whose predecessor is complete
  for (const throttled of throttledSteps) {
    if (throttled.order <= 1) {
      // First step — should be active
      await db.taskStep.updateMany({
        where: { id: throttled.id, status: 'pending' },
        data: { status: 'active' },
      })
    } else {
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

  const results = await Promise.allSettled(
    allSteps.map(step => dispatchStep(step.id))
  )

  return {
    polled: allSteps.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}
