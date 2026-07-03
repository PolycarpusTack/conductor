import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { taskBoardInclude } from '@/lib/server/selects'

const log = getLogger('claim-reaper')

/**
 * Claim-lease reaper (B-2, Model B).
 *
 * Returns IN_PROGRESS tasks whose claim lease has expired to BACKLOG so
 * /api/agent/next can offer them again. Runs from the scheduler's global tick.
 *
 * Scope guards:
 * - Only tasks with a SET-and-expired claimExpiresAt are reaped. Dispatcher
 *   -driven tasks never get a claim lease, so they are structurally excluded.
 * - Tasks with chain steps still in flight (status 'active') are skipped —
 *   the step lease machinery owns their liveness.
 * - The write is guarded on claimExpiresAt still being expired, so a renewal
 *   landing between the read and the write wins the race.
 *
 * Returns the number of tasks reaped.
 */
export async function reapExpiredClaims(): Promise<number> {
  const now = new Date()

  const candidates = await db.task.findMany({
    where: {
      status: 'IN_PROGRESS',
      deletedAt: null,
      claimExpiresAt: { not: null, lt: now },
      steps: { none: { status: 'active' } },
    },
    select: {
      id: true,
      projectId: true,
      agentId: true,
      title: true,
      claimExpiresAt: true,
    },
  })

  let reaped = 0

  for (const candidate of candidates) {
    // Guarded write: only reap if the claim is STILL expired — a heartbeat
    // renewal between the sweep's read and this write leaves count at 0.
    const result = await db.task.updateMany({
      where: {
        id: candidate.id,
        status: 'IN_PROGRESS',
        claimExpiresAt: { lt: now },
      },
      data: {
        status: 'BACKLOG',
        agentId: null,
        claimExpiresAt: null,
      },
    })

    if (result.count === 0) continue // renewed or completed meanwhile
    reaped++

    await db.activityLog.create({
      data: {
        action: 'task_claim_reaped',
        taskId: candidate.id,
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        details: JSON.stringify({
          previousAgentId: candidate.agentId,
          claimExpiredAt: candidate.claimExpiresAt?.toISOString() ?? null,
          reason: 'claim_lease_expired',
        }),
      },
    })

    // Status changed → board update mirrors the routes' 'task-moved' convention.
    const task = await db.task.findUnique({
      where: { id: candidate.id },
      include: taskBoardInclude,
    })
    broadcastProjectEvent(candidate.projectId, 'task-moved', { taskId: candidate.id, task })

    log.info('reaped expired claim', {
      taskId: candidate.id,
      projectId: candidate.projectId,
      previousAgentId: candidate.agentId,
    })
  }

  return reaped
}
