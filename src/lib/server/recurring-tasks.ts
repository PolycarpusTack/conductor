// Recurring tasks: instantiate a task template (Epic S6) on a cadence.
//
// The runner rides the scheduler's 60s global tick next to the S7 automation
// sweep. Each due row is claimed atomically — updateMany rolls nextRunAt
// forward and stamps lastRunAt, so concurrent ticks can't double-create.
// Creation fires the normal `task-created` event, so S7 automation rules
// (auto-assign, set-priority, …) compose with recurrences for free.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { startChain } from '@/lib/server/dispatch'
import { fireProjectEvent } from '@/lib/server/project-event'
import { safeJsonParse } from '@/lib/server/utils'

const log = getLogger('recurring-tasks')

export type Cadence = 'daily' | 'weekly' | 'monthly'

export interface CadenceOptions {
  dayOfWeek?: number | null // 0=Sunday..6 (weekly)
  dayOfMonth?: number | null // 1-28 (monthly)
  timeOfDay: string // "HH:MM" server-local
}

/** Next occurrence strictly after `from`. */
export function computeNextRunAt(cadence: Cadence, opts: CadenceOptions, from: Date): Date {
  const [hours, minutes] = opts.timeOfDay.split(':').map(Number)
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(hours, minutes)

  switch (cadence) {
    case 'daily': {
      if (next <= from) next.setDate(next.getDate() + 1)
      return next
    }
    case 'weekly': {
      const targetDay = opts.dayOfWeek ?? 1 // default Monday
      let delta = (targetDay - next.getDay() + 7) % 7
      if (delta === 0 && next <= from) delta = 7
      next.setDate(next.getDate() + delta)
      return next
    }
    case 'monthly': {
      const targetDate = Math.min(Math.max(opts.dayOfMonth ?? 1, 1), 28)
      next.setDate(targetDate)
      if (next <= from) {
        next.setMonth(next.getMonth() + 1, targetDate)
      }
      return next
    }
  }
}

interface ChainTemplateStep {
  agentId?: string | null
  agentRole?: string
  humanLabel?: string
  mode: string
  instructions?: string
  autoContinue?: boolean
}

export async function runRecurringTasks(): Promise<void> {
  const now = new Date()
  const due = await db.recurringTask.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    include: {
      taskTemplate: { include: { chainTemplate: true } },
    },
    take: 20, // a runaway backlog shouldn't stall the tick; the rest go next minute
  })

  for (const recurrence of due) {
    // Atomic claim: roll nextRunAt forward first — only one tick wins.
    const claimed = await db.recurringTask.updateMany({
      where: { id: recurrence.id, nextRunAt: { lte: now } },
      data: {
        nextRunAt: computeNextRunAt(
          recurrence.cadence as Cadence,
          { dayOfWeek: recurrence.dayOfWeek, dayOfMonth: recurrence.dayOfMonth, timeOfDay: recurrence.timeOfDay },
          now,
        ),
        lastRunAt: now,
      },
    })
    if (claimed.count === 0) continue

    try {
      await instantiate(recurrence)
    } catch (error) {
      log.error('recurring task creation failed', error, { recurringTaskId: recurrence.id })
    }
  }
}

interface DueRecurrence {
  id: string
  name: string
  projectId: string
  taskTemplate: {
    name: string
    titlePattern: string | null
    description: string | null
    priority: string | null
    tag: string | null
    notes: string | null
    chainTemplate: { steps: string } | null
  }
}

async function instantiate(recurrence: DueRecurrence): Promise<void> {
  const template = recurrence.taskTemplate
  const today = new Date().toISOString().slice(0, 10)
  const title = template.titlePattern
    ? template.titlePattern.replaceAll('{date}', today)
    : `${template.name} — ${today}`

  const chainSteps = template.chainTemplate
    ? safeJsonParse<ChainTemplateStep[]>(template.chainTemplate.steps, [])
    : []

  // Chain templates carry agentRole, not agentId — resolve to the project's
  // first matching agent so the chain can actually dispatch. Unresolvable
  // roles leave the step agentless (it waits for a human to assign).
  const roles = [...new Set(chainSteps.map((s) => s.agentRole).filter((r): r is string => !!r))]
  const roleAgents = new Map<string, string>()
  for (const role of roles) {
    const agent = await db.agent.findFirst({
      where: { projectId: recurrence.projectId, role },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (agent) roleAgents.set(role, agent.id)
  }

  // Per-mode maxAttempts default (Epic S4) — same semantic as the task routes.
  const modeRows = chainSteps.length > 0
    ? await db.projectMode.findMany({
        where: { projectId: recurrence.projectId, name: { in: [...new Set(chainSteps.map((s) => s.mode))] } },
        select: { name: true, maxAttempts: true },
      })
    : []
  const modeMaxAttempts = new Map(modeRows.map((m) => [m.name, m.maxAttempts]))

  const status = chainSteps.length > 0 ? 'IN_PROGRESS' : 'BACKLOG'

  const task = await db.task.create({
    data: {
      title,
      description: template.description,
      status,
      priority: (template.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | null) || 'MEDIUM',
      tag: template.tag,
      notes: template.notes,
      projectId: recurrence.projectId,
      order: 0,
      ...(chainSteps.length > 0
        ? {
            steps: {
              create: chainSteps.map((step, index) => ({
                order: index + 1,
                agentId: step.agentId || (step.agentRole ? roleAgents.get(step.agentRole) ?? null : null),
                humanLabel: step.humanLabel || null,
                mode: step.mode,
                instructions: step.instructions || null,
                autoContinue: step.autoContinue ?? (step.mode !== 'human'),
                maxRetries: modeMaxAttempts.get(step.mode) ?? 2,
              })),
            },
          }
        : {}),
    },
  })

  await db.activityLog.create({
    data: {
      action: 'recurring_task_created',
      level: 'info',
      component: 'automation',
      projectId: recurrence.projectId,
      taskId: task.id,
      details: JSON.stringify({ recurringTaskId: recurrence.id, recurrenceName: recurrence.name, title }),
    },
  }).catch(() => {})

  // Normal creation event — S7 rules (auto-assign etc.) compose with this.
  await fireProjectEvent(recurrence.projectId, 'task-created', {
    taskId: task.id,
    title,
    tag: template.tag,
    priority: template.priority || 'MEDIUM',
    recurring: true,
  })

  if (status === 'IN_PROGRESS') {
    try {
      await startChain(task.id, recurrence.projectId)
    } catch (error) {
      log.error('startChain failed for recurring task', error, { taskId: task.id })
    }
  }

  log.info('recurring task created', { recurringTaskId: recurrence.id, taskId: task.id, title })
}
