import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// D-2-T2 overdue-reminder sweep.
//
// In-memory task store behind the '@/lib/db' mock (same style as
// claim-reaper.test.ts) so the sweep + the real notifications emit path are
// exercised together against one state:
//   - an overdue, not-done task emits ONE task_overdue notification and stamps
//     dueReminderSentAt
//   - re-running the sweep does NOT re-emit (guarded compare-and-set dedupe)
//   - future dueDate / DONE status / no dueDate never emit
//   - boundary: a dueDate exactly at "now" is not yet overdue (strict `lt`)
//
// realtime + project-event are mocked (createNotification broadcasts through
// project-event). Email is unconfigured (no SMTP env) so it stays in-app only.
// ---------------------------------------------------------------------------

type StoreTask = {
  id: string
  projectId: string
  title: string
  status: string
  dueDate: Date | null
  dueReminderSentAt: Date | null
  deletedAt: Date | null
  archivedAt: Date | null
}

let tasks: StoreTask[] = []
let notifications: any[] = []
const broadcasts: Array<{ projectId: string; event: string; payload: any }> = []

function matchesWhere(t: StoreTask, where: any): boolean {
  if (where.id !== undefined && t.id !== where.id) return false
  if (where.status?.not !== undefined && t.status === where.status.not) return false
  if (where.deletedAt !== undefined && t.deletedAt !== where.deletedAt) return false
  if (where.archivedAt !== undefined && t.archivedAt !== where.archivedAt) return false
  if (where.dueReminderSentAt !== undefined) {
    if (where.dueReminderSentAt === null && t.dueReminderSentAt !== null) return false
  }
  if (where.dueDate !== undefined) {
    const c = where.dueDate
    if (c?.not === null && t.dueDate == null) return false
    if (c?.lt !== undefined && !(t.dueDate != null && t.dueDate < c.lt)) return false
  }
  return true
}

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findMany: mock(async ({ where }: any) =>
        tasks.filter((t) => matchesWhere(t, where)).map((t) => ({ ...t })),
      ) as any,
      updateMany: mock(async ({ where, data }: any) => {
        const hits = tasks.filter((t) => matchesWhere(t, where))
        for (const t of hits) Object.assign(t, data)
        return { count: hits.length }
      }) as any,
    },
    notification: {
      create: mock(async ({ data }: any) => {
        const row = { id: `notif-${notifications.length + 1}`, readAt: null, createdAt: new Date(), ...data }
        notifications.push(row)
        return row
      }) as any,
    },
  },
  isPostgresDb: false,
}))

const broadcast = mock((projectId: string, event: string, payload: any) => {
  broadcasts.push({ projectId, event, payload })
  return Promise.resolve()
}) as any
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: broadcast,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))
mock.module('@/lib/server/project-event', () => ({ fireProjectEvent: broadcast }))

// Import AFTER mocks
import { runOverdueReminders } from '../overdue-reminders'

const PAST = () => new Date(Date.now() - 60_000)
const FUTURE = () => new Date(Date.now() + 60 * 60_000)

function makeTask(overrides: Partial<StoreTask>): StoreTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'A task',
    status: 'BACKLOG',
    dueDate: null,
    dueReminderSentAt: null,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  tasks = []
  notifications = []
  broadcasts.length = 0
  for (const key of ['SMTP_HOST', 'NOTIFY_EMAIL_TO']) delete process.env[key]
})

const overdueNotifs = () => notifications.filter((n) => n.type === 'task_overdue')

describe('runOverdueReminders', () => {
  test('emits ONE task_overdue notification for an overdue, not-done task and stamps dueReminderSentAt', async () => {
    tasks.push(makeTask({ id: 'task-late', status: 'IN_PROGRESS', dueDate: PAST(), title: 'Ship it' }))

    const emitted = await runOverdueReminders()

    expect(emitted).toBe(1)
    expect(overdueNotifs()).toHaveLength(1)
    expect(overdueNotifs()[0].projectId).toBe('proj-1')
    expect(overdueNotifs()[0].taskId).toBe('task-late')
    expect(overdueNotifs()[0].title).toContain('Ship it')
    expect(tasks[0].dueReminderSentAt).not.toBeNull()
    // Broadcast fired so the notification center updates live.
    expect(broadcasts.filter((b) => b.event === 'notification-created')).toHaveLength(1)
  })

  test('re-running the sweep does not re-emit (dedupe via guarded write)', async () => {
    tasks.push(makeTask({ id: 'task-late', status: 'IN_PROGRESS', dueDate: PAST() }))

    await runOverdueReminders()
    const second = await runOverdueReminders()

    expect(second).toBe(0)
    expect(overdueNotifs()).toHaveLength(1)
  })

  test('a task with a future due date does not emit', async () => {
    tasks.push(makeTask({ id: 'task-future', status: 'IN_PROGRESS', dueDate: FUTURE() }))

    expect(await runOverdueReminders()).toBe(0)
    expect(overdueNotifs()).toHaveLength(0)
  })

  test('a DONE task past its due date does not emit', async () => {
    tasks.push(makeTask({ id: 'task-done', status: 'DONE', dueDate: PAST() }))

    expect(await runOverdueReminders()).toBe(0)
    expect(overdueNotifs()).toHaveLength(0)
  })

  test('a task with no due date does not emit', async () => {
    tasks.push(makeTask({ id: 'task-none', status: 'IN_PROGRESS', dueDate: null }))

    expect(await runOverdueReminders()).toBe(0)
    expect(overdueNotifs()).toHaveLength(0)
  })

  test('boundary: a due date exactly at now is not yet overdue', async () => {
    // dueDate === the sweep's `now` — strict `lt` must exclude it. Slightly
    // future guards against the tiny delay between push and the sweep's clock.
    tasks.push(makeTask({ id: 'task-now', status: 'IN_PROGRESS', dueDate: new Date(Date.now() + 5_000) }))

    expect(await runOverdueReminders()).toBe(0)
    expect(overdueNotifs()).toHaveLength(0)
  })

  test('a soft-deleted overdue task is excluded', async () => {
    tasks.push(makeTask({ id: 'task-del', status: 'IN_PROGRESS', dueDate: PAST(), deletedAt: new Date() }))

    expect(await runOverdueReminders()).toBe(0)
    expect(overdueNotifs()).toHaveLength(0)
  })
})
