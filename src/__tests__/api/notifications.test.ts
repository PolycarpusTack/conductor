import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// ---------------------------------------------------------------------------
// C-4 — GET /api/projects/[id]/notifications (unread first, limit 50) and
// POST mark-read (single + all). Session-authed, withErrorHandling.
// ---------------------------------------------------------------------------

type NotificationRow = {
  id: string
  projectId: string
  type: string
  title: string
  body: string | null
  taskId: string | null
  readAt: Date | null
  createdAt: Date
}

let rows: NotificationRow[] = []

function matches(row: NotificationRow, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false
  if (where.projectId !== undefined && row.projectId !== where.projectId) return false
  if (where.readAt !== undefined) {
    if (where.readAt === null) {
      if (row.readAt !== null) return false
    } else if (where.readAt.not === null) {
      if (row.readAt === null) return false
    }
  }
  return true
}

mock.module('@/lib/db', () => ({
  db: {
    notification: {
      findMany: async (args: any) => {
        const where = args?.where ?? {}
        let hits = rows.filter((r) => matches(r, where))
        hits = [...hits].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        if (typeof args?.take === 'number') hits = hits.slice(0, args.take)
        return hits.map((r) => ({ ...r }))
      },
      count: async (args: any) => rows.filter((r) => matches(r, args?.where ?? {})).length,
      updateMany: async (args: any) => {
        const hits = rows.filter((r) => matches(r, args?.where ?? {}))
        for (const r of hits) Object.assign(r, args?.data ?? {})
        return { count: hits.length }
      },
    },
  },
  isPostgresDb: false,
}))

// Import AFTER mocks
import { GET, POST } from '@/app/api/projects/[id]/notifications/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

let seq = 0
function seed(overrides: Partial<NotificationRow> = {}): NotificationRow {
  seq += 1
  const row: NotificationRow = {
    id: `n-${seq}`,
    projectId: 'proj-1',
    type: 'dead_letter',
    title: `Notification ${seq}`,
    body: null,
    taskId: null,
    readAt: null,
    createdAt: new Date(Date.now() + seq * 1000), // strictly increasing
    ...overrides,
  }
  rows.push(row)
  return row
}

beforeEach(() => {
  rows = []
  seq = 0
  setSession(ADMIN_SESSION)
})

describe('GET /api/projects/[id]/notifications', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/notifications'), params('proj-1'))
    expect(res.status).toBe(401)
  })

  test('returns unread first (each group newest-first) with an unreadCount', async () => {
    const readOld = seed({ readAt: new Date() })
    const unreadOld = seed()
    const readNew = seed({ readAt: new Date() })
    const unreadNew = seed()

    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/notifications'), params('proj-1'))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.unreadCount).toBe(2)
    expect(data.notifications.map((n: NotificationRow) => n.id)).toEqual([
      unreadNew.id,
      unreadOld.id,
      readNew.id,
      readOld.id,
    ])
  })

  test('scopes to the project and caps at 50', async () => {
    for (let i = 0; i < 60; i++) seed()
    seed({ projectId: 'proj-other' })

    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/notifications'), params('proj-1'))
    const data = await res.json()

    expect(data.notifications).toHaveLength(50)
    expect(data.notifications.every((n: NotificationRow) => n.projectId === 'proj-1')).toBe(true)
    expect(data.unreadCount).toBe(60)
  })
})

describe('POST /api/projects/[id]/notifications (mark read)', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const res = await POST(
      makeRequest('http://localhost/api/projects/proj-1/notifications', { method: 'POST', body: { all: true } }),
      params('proj-1'),
    )
    expect(res.status).toBe(401)
  })

  test('marks a single notification read (project-scoped)', async () => {
    const mine = seed()
    const other = seed({ projectId: 'proj-other' })

    const res = await POST(
      makeRequest('http://localhost/api/projects/proj-1/notifications', { method: 'POST', body: { id: mine.id } }),
      params('proj-1'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(1)
    expect(mine.readAt).not.toBeNull()
    expect(other.readAt).toBeNull()

    // A foreign id through this project's route updates nothing.
    const cross = await POST(
      makeRequest('http://localhost/api/projects/proj-1/notifications', { method: 'POST', body: { id: other.id } }),
      params('proj-1'),
    )
    expect((await cross.json()).updated).toBe(0)
    expect(other.readAt).toBeNull()
  })

  test('marks all unread notifications read for the project only', async () => {
    seed()
    seed()
    const alreadyRead = seed({ readAt: new Date('2026-01-01') })
    const foreign = seed({ projectId: 'proj-other' })

    const res = await POST(
      makeRequest('http://localhost/api/projects/proj-1/notifications', { method: 'POST', body: { all: true } }),
      params('proj-1'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(2)
    expect(rows.filter((r) => r.projectId === 'proj-1' && r.readAt === null)).toHaveLength(0)
    expect(alreadyRead.readAt?.toISOString()).toBe(new Date('2026-01-01').toISOString())
    expect(foreign.readAt).toBeNull()
  })

  test('400 when neither id nor all is provided', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/projects/proj-1/notifications', { method: 'POST', body: {} }),
      params('proj-1'),
    )
    expect(res.status).toBe(400)
  })
})
