import { db } from '@/lib/db'
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('budget')

// B-7 spend budgets. The nullable Project.budgetUsd column IS the feature
// flag (same pattern as B-2's claimExpiresAt): projects without a budget are
// filtered out at the first query and behave exactly as before.

/** Start of the current UTC calendar month — the budget window boundary. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Month-to-date recorded cost for a project, in USD. Source of truth is
 * StepExecution.cost — the same field the runtimes/usage analytics rollup
 * sums — aggregated in one query (started-at window, like that rollup).
 */
export async function getMonthToDateSpend(projectId: string, now: Date = new Date()): Promise<number> {
  const result = await db.stepExecution.aggregate({
    _sum: { cost: true },
    where: {
      startedAt: { gte: monthStartUtc(now) },
      step: { task: { projectId } },
    },
  })
  return result._sum.cost ?? 0
}

const BUDGET_ACTIONS = ['budget_exceeded', 'budget_lifted']

/**
 * Returns the subset of the given projects whose month-to-date recorded
 * spend has reached their budget — those must not dispatch this tick.
 *
 * Activity semantics (one entry per pause episode, not per tick): the most
 * recent budget_* activity row is the episode marker. An un-lifted
 * budget_exceeded means "already paused" — nothing new is written while the
 * pause holds; the first under-budget tick after a pause writes
 * budget_lifted. The read-then-write pair is not atomic, so two concurrent
 * pollers could rarely double-write an entry — harmless (audit-only), so we
 * keep it simple rather than lock.
 */
export async function filterBudgetPausedProjects(projectIds: string[]): Promise<Set<string>> {
  const paused = new Set<string>()
  if (projectIds.length === 0) return paused

  const budgeted = await db.project.findMany({
    where: { id: { in: projectIds }, budgetUsd: { not: null } },
    select: { id: true, budgetUsd: true },
  })
  if (budgeted.length === 0) return paused

  for (const project of budgeted) {
    const budgetUsd = project.budgetUsd as number
    try {
      const spentUsd = await getMonthToDateSpend(project.id)
      const overBudget = spentUsd >= budgetUsd

      const latest = await db.activityLog.findFirst({
        where: { projectId: project.id, action: { in: BUDGET_ACTIONS } },
        orderBy: { createdAt: 'desc' },
        select: { action: true },
      })
      const alreadyPaused = latest?.action === 'budget_exceeded'

      if (overBudget) {
        paused.add(project.id)
        if (!alreadyPaused) {
          log.warn(`project ${project.id} paused: month-to-date spend $${spentUsd} >= budget $${budgetUsd}`)
          await db.activityLog.create({
            data: {
              action: 'budget_exceeded',
              level: 'warn',
              component: 'system',
              projectId: project.id,
              details: JSON.stringify({ budgetUsd, spentUsd }),
            },
          })
          broadcastProjectEvent(project.id, 'budget-exceeded', { budgetUsd, spentUsd })
        }
      } else if (alreadyPaused) {
        log.info(`project ${project.id} resumed: month-to-date spend $${spentUsd} < budget $${budgetUsd}`)
        await db.activityLog.create({
          data: {
            action: 'budget_lifted',
            level: 'info',
            component: 'system',
            projectId: project.id,
            details: JSON.stringify({ budgetUsd, spentUsd }),
          },
        })
        broadcastProjectEvent(project.id, 'budget-lifted', { budgetUsd, spentUsd })
      }
    } catch (err) {
      // A broken budget check must not take the dispatcher down with it —
      // fail open for this tick and let the next tick retry.
      log.error(`budget check failed for project ${project.id}`, err)
    }
  }

  return paused
}
