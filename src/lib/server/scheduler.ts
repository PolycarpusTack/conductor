import { db } from '@/lib/db'
import { pollAndDispatch } from '@/lib/server/step-queue'

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
let globalInitialized = false

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
    console.error(`[Scheduler] Poll error for project ${projectId}:`, error)
  }
}

function startPolling(projectId: string, pollMs: number) {
  const existing = schedulers.get(projectId)
  if (existing?.running) return // already running

  console.log(`[Scheduler] Starting automation for project ${projectId} (${pollMs}ms interval)`)

  const interval = setInterval(() => pollProject(projectId), pollMs)
  // Run immediately on start
  pollProject(projectId)

  schedulers.set(projectId, { projectId, interval, running: true })
}

function stopPolling(projectId: string) {
  const existing = schedulers.get(projectId)
  if (!existing?.running) return

  console.log(`[Scheduler] Stopping automation for project ${projectId}`)

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
        console.error(`[Scheduler] Invalid automationSchedule JSON for project ${projectId}:`, error)
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
      console.error(`[Scheduler] Invalid automationSchedule JSON for project ${project.id}:`, error)
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
}

/**
 * Initialize the scheduler system on application startup.
 * Starts automation for projects configured with 'startup' or 'always' mode,
 * and begins the schedule checker for 'scheduled' projects.
 */
export async function initializeScheduler() {
  if (globalInitialized) return
  globalInitialized = true

  console.log('[Scheduler] Initializing automation scheduler...')

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
  setInterval(checkScheduledProjects, 60000)

  console.log(`[Scheduler] Initialized: ${autoStartProjects.length} auto-start project(s)`)
}

/**
 * Cleanup all schedulers (for graceful shutdown).
 */
export function shutdownScheduler() {
  for (const [projectId] of schedulers) {
    stopPolling(projectId)
  }
  schedulers.clear()
  globalInitialized = false
  console.log('[Scheduler] All schedulers stopped')
}
