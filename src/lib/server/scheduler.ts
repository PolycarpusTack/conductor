import { db } from '@/lib/db'
import { runAutomationSweeps } from '@/lib/server/automation-sweep'
import { reapExpiredClaims } from '@/lib/server/claim-reaper'
import { runOverdueReminders } from '@/lib/server/overdue-reminders'
import { runRecurringTasks } from '@/lib/server/recurring-tasks'
import { getLogger } from '@/lib/server/logger'
import { startSchedulerOwnership, type SchedulerOwnership } from '@/lib/server/scheduler-lock'
import { pollAndDispatch } from '@/lib/server/step-queue'

const log = getLogger('scheduler')

interface ScheduleWindow {
  startDay: number  // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string // "HH:MM"
  endDay: number
  endTime: string
}

interface ProjectScheduler {
  projectId: string
  interval: ReturnType<typeof setInterval> | null
  running: boolean
}

// Global scheduler state (per-process singleton)
const schedulers = new Map<string, ProjectScheduler>()
let globalCheckInterval: ReturnType<typeof setInterval> | null = null
let checkInProgress = false
// F-3 single-instance guard (ADR-0006): dispatch only runs while this instance
// owns the scheduler lock. Null until initializeScheduler() runs.
let ownership: SchedulerOwnership | null = null

function isWithinSchedule(schedule: ScheduleWindow): boolean {
  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  // Normalize days to allow wrapping (e.g., Friday 18:00 → Monday 08:00)
  const startMinutes = schedule.startDay * 1440 + timeToMinutes(schedule.startTime)
  const endMinutes = schedule.endDay * 1440 + timeToMinutes(schedule.endTime)
  const currentMinutes = currentDay * 1440 + timeToMinutes(currentTime)

  if (startMinutes <= endMinutes) {
    // Normal range (e.g., Mon 09:00 → Fri 17:00)
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes
  } else {
    // Wrapping range (e.g., Fri 18:00 → Mon 08:00)
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes
  }
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

async function pollProject(projectId: string) {
  try {
    await pollAndDispatch(projectId)
  } catch (error) {
    log.error('poll failed', error, { projectId })
  }
}

function startPolling(projectId: string, pollMs: number) {
  const existing = schedulers.get(projectId)
  if (existing?.running) return // already running

  log.info('starting automation', { projectId, pollMs })

  const interval = setInterval(() => pollProject(projectId), pollMs)
  // Run immediately on start
  pollProject(projectId)

  schedulers.set(projectId, { projectId, interval, running: true })
}

function stopPolling(projectId: string) {
  const existing = schedulers.get(projectId)
  if (!existing?.running) return

  log.info('stopping automation', { projectId })

  if (existing.interval) {
    clearInterval(existing.interval)
  }
  schedulers.set(projectId, { projectId, interval: null, running: false })
}

export function isProjectRunning(projectId: string): boolean {
  return schedulers.get(projectId)?.running ?? false
}

export function getSchedulerStatus(): Array<{ projectId: string; running: boolean }> {
  return Array.from(schedulers.entries()).map(([projectId, s]) => ({
    projectId,
    running: s.running,
  }))
}

/**
 * Start automation for a specific project based on its config.
 */
export async function startProjectAutomation(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { automationMode: true, automationSchedule: true, automationPollMs: true },
  })

  if (!project) return

  const pollMs = project.automationPollMs || 10000

  switch (project.automationMode) {
    case 'always':
    case 'startup':
      startPolling(projectId, pollMs)
      break

    case 'scheduled': {
      if (!project.automationSchedule) break
      let schedule: ScheduleWindow
      try {
        schedule = JSON.parse(project.automationSchedule)
      } catch (error) {
        log.error('invalid automationSchedule JSON', error, { projectId })
        return
      }
      if (isWithinSchedule(schedule)) {
        startPolling(projectId, pollMs)
      } else {
        stopPolling(projectId)
      }
      break
    }

    case 'manual':
    default:
      // Don't auto-start — wait for manual trigger
      break
  }
}

/**
 * Stop automation for a specific project.
 */
export function stopProjectAutomation(projectId: string) {
  stopPolling(projectId)
}

/**
 * Manually start the poller regardless of config mode.
 */
export function manualStartAutomation(projectId: string, pollMs?: number) {
  startPolling(projectId, pollMs || 10000)
}

/**
 * Check scheduled projects and start/stop as needed.
 * Called periodically by the schedule checker.
 */
async function checkScheduledProjects() {
  if (checkInProgress) return
  checkInProgress = true
  try {
    const scheduledProjects = await db.project.findMany({
      where: { automationMode: 'scheduled' },
      select: { id: true, automationSchedule: true, automationPollMs: true },
    })

    for (const project of scheduledProjects) {
      if (!project.automationSchedule) continue
      let schedule: ScheduleWindow
      try {
        schedule = JSON.parse(project.automationSchedule)
      } catch (error) {
        log.error('invalid automationSchedule JSON', error, { projectId: project.id })
        continue
      }
      const shouldRun = isWithinSchedule(schedule)
      const isRunning = isProjectRunning(project.id)

      if (shouldRun && !isRunning) {
        startPolling(project.id, project.automationPollMs || 10000)
      } else if (!shouldRun && isRunning) {
        stopPolling(project.id)
      }
    }

    // Time-based automation rules (Epic S7 Phase 2) ride the same global
    // tick — the sweep self-limits to once per hour per project.
    await runAutomationSweeps().catch((error) => log.error('automation sweep failed', error))

    // Recurring tasks: due rows are claimed atomically, so the 60s tick is
    // just the heartbeat — cadence lives on each row's nextRunAt.
    await runRecurringTasks().catch((error) => log.error('recurring tasks failed', error))

    // Claim-lease reaper (B-2): global sweep returning expired Model-B claims
    // to BACKLOG. Guarded writes make it safe against heartbeat renewals.
    await reapExpiredClaims().catch((error) => log.error('claim reaper failed', error))

    // Overdue reminders (D-2): emit one task_overdue notification per task that
    // passed its due date without completing. Guarded dueReminderSentAt write
    // makes it exactly-once, so the 60s tick can re-run safely.
    await runOverdueReminders().catch((error) => log.error('overdue reminders failed', error))
  } finally {
    checkInProgress = false
  }
}

/**
 * Start the actual dispatch loops (auto-start pollers + 60s global tick).
 * Called only when this instance OWNS the scheduler lock (F-3, ADR-0006).
 * Idempotent — a re-acquisition after takeover is a no-op if already running.
 */
async function startDispatchLoops() {
  if (globalCheckInterval) return
  log.info('starting dispatch loops (scheduler ownership held)')

  // Start projects with 'startup' or 'always' mode
  const autoStartProjects = await db.project.findMany({
    where: { automationMode: { in: ['startup', 'always'] } },
    select: { id: true, automationPollMs: true },
  })

  for (const project of autoStartProjects) {
    startPolling(project.id, project.automationPollMs || 10000)
  }

  // Check scheduled projects immediately
  await checkScheduledProjects()

  // Check scheduled projects every 60 seconds
  globalCheckInterval = setInterval(checkScheduledProjects, 60000)

  log.info('dispatch loops started', { autoStartProjects: autoStartProjects.length })
}

/**
 * Stop the dispatch loops without releasing the lock (used on relinquish when
 * another instance took over, and as the teardown half of shutdown).
 */
function stopDispatchLoops() {
  if (globalCheckInterval) {
    clearInterval(globalCheckInterval)
    globalCheckInterval = null
  }
  for (const [projectId] of schedulers) {
    stopPolling(projectId)
  }
  schedulers.clear()
}

/**
 * Initialize the scheduler system on application startup.
 *
 * F-3 (ADR-0006): dispatch is gated behind a coarse advisory "scheduler owner"
 * lock so a second app instance against the same DB does not double-dispatch.
 * The winning instance starts the dispatch loops and heartbeats the lock; a
 * losing instance stands by and takes over only if the owner dies. If the lock
 * table is not present yet (schema pending), the guard fails open and the loops
 * start as before.
 */
export async function initializeScheduler() {
  if (ownership) return
  log.info('initializing automation scheduler')

  ownership = await startSchedulerOwnership({
    onAcquire: startDispatchLoops,
    onRelinquish: () => {
      log.warn('relinquishing dispatch — another scheduler instance owns the lock')
      stopDispatchLoops()
    },
  })
}

/**
 * Cleanup all schedulers (for graceful shutdown).
 */
export function shutdownScheduler() {
  if (ownership) {
    ownership.stop()
    ownership = null
  }
  stopDispatchLoops()
  log.info('all schedulers stopped')
}
