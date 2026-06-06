// Time-based automation rules (Epic S7 Phase 2).
//
// Clock-driven rules don't get their own engine: this sweep manufactures
// synthetic events (`task-stale`, `review-gate-stale`) through
// fireProjectEvent, and the normal trigger → filter → reaction flow —
// including the Phase 1 internal actions like task:archive — decides what
// actually happens. The sweep itself never mutates tasks.
//
// Cadence: the scheduler's 60s global tick calls runAutomationSweeps(); each
// project is swept at most once per hour, claimed atomically via an
// updateMany on lastAutomationSweepAt so concurrent ticks can't double-fire.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { fireProjectEvent } from '@/lib/server/project-event'

const log = getLogger('automation-sweep')

const SWEEP_INTERVAL_MS = 60 * 60 * 1000 // once per hour per project
const MAX_EVENTS_PER_SWEEP = 50 // per event type; the next sweep picks up the rest

export async function runAutomationSweeps(): Promise<void> {
  const cutoff = new Date(Date.now() - SWEEP_INTERVAL_MS)

  const candidates = await db.project.findMany({
    where: {
      OR: [{ autoArchiveDays: { not: null } }, { reviewEscalationHours: { not: null } }],
      AND: [{ OR: [{ lastAutomationSweepAt: null }, { lastAutomationSweepAt: { lt: cutoff } }] }],
    },
    select: { id: true, autoArchiveDays: true, reviewEscalationHours: true, lastAutomationSweepAt: true },
  })

  for (const project of candidates) {
    // Atomic claim — only one tick wins the sweep for this hour.
    const claimed = await db.project.updateMany({
      where: {
        id: project.id,
        OR: [{ lastAutomationSweepAt: null }, { lastAutomationSweepAt: { lt: cutoff } }],
      },
      data: { lastAutomationSweepAt: new Date() },
    })
    if (claimed.count === 0) continue

    try {
      await sweepProject(project)
    } catch (error) {
      log.error('sweep failed', error, { projectId: project.id })
    }
  }
}

async function sweepProject(project: {
  id: string
  autoArchiveDays: number | null
  reviewEscalationHours: number | null
}): Promise<void> {
  if (project.autoArchiveDays) {
    const idleSince = new Date(Date.now() - project.autoArchiveDays * 24 * 60 * 60 * 1000)
    const staleTasks = await db.task.findMany({
      where: {
        projectId: project.id,
        status: 'DONE',
        archivedAt: null,
        deletedAt: null,
        updatedAt: { lt: idleSince },
      },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: MAX_EVENTS_PER_SWEEP + 1,
    })

    const capped = staleTasks.length > MAX_EVENTS_PER_SWEEP
    for (const task of staleTasks.slice(0, MAX_EVENTS_PER_SWEEP)) {
      await fireProjectEvent(project.id, 'task-stale', {
        taskId: task.id,
        title: task.title,
        status: 'DONE',
        idleDays: Math.floor((Date.now() - task.updatedAt.getTime()) / (24 * 60 * 60 * 1000)),
        reason: 'auto-archive-candidate',
      })
    }
    if (capped) {
      log.warn('task-stale sweep capped — remainder picked up next hour', {
        projectId: project.id,
        cap: MAX_EVENTS_PER_SWEEP,
      })
    }
  }

  if (project.reviewEscalationHours) {
    const staleSince = new Date(Date.now() - project.reviewEscalationHours * 60 * 60 * 1000)
    // activateStep doesn't stamp startedAt, so createdAt is the upper bound —
    // a gate can't have been waiting longer than it has existed.
    const staleGates = await db.taskStep.findMany({
      where: {
        status: 'active',
        mode: 'human',
        task: { projectId: project.id, deletedAt: null, archivedAt: null },
        OR: [
          { startedAt: { lt: staleSince } },
          { startedAt: null, createdAt: { lt: staleSince } },
        ],
      },
      select: { id: true, taskId: true, humanLabel: true, startedAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_EVENTS_PER_SWEEP + 1,
    })

    const capped = staleGates.length > MAX_EVENTS_PER_SWEEP
    for (const step of staleGates.slice(0, MAX_EVENTS_PER_SWEEP)) {
      const waitingSince = step.startedAt ?? step.createdAt
      await fireProjectEvent(project.id, 'review-gate-stale', {
        taskId: step.taskId,
        stepId: step.id,
        humanLabel: step.humanLabel,
        waitingHours: Math.floor((Date.now() - waitingSince.getTime()) / (60 * 60 * 1000)),
      })
    }
    if (capped) {
      log.warn('review-gate-stale sweep capped — remainder picked up next hour', {
        projectId: project.id,
        cap: MAX_EVENTS_PER_SWEEP,
      })
    }
  }
}
