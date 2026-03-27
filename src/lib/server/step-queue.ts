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

  if (steps.length === 0) return { polled: 0, succeeded: 0, failed: 0 }

  const results = await Promise.allSettled(
    steps.map(step => dispatchStep(step.id))
  )

  return {
    polled: steps.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  }
}
