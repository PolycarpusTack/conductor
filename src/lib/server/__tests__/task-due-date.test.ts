import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// D-2 due dates — contract validation + PUT persistence.
//
// Part 1 (pure): createTaskSchema / updateTaskSchema accept an ISO datetime
// (coerced to Date) and null (clear), leave undefined alone, and reject garbage.
// Part 2: PUT /api/tasks/[id] persists dueDate (Date) and clears it (null)
// through the spread of parsed.data into db.task.update.
// ---------------------------------------------------------------------------

import { createTaskSchema, updateTaskSchema } from '../contracts'

describe('createTaskSchema.dueDate (D-2)', () => {
  const base = { title: 'T', projectId: 'p1' }

  test('coerces an ISO datetime string to a Date', () => {
    const parsed = createTaskSchema.parse({ ...base, dueDate: '2026-07-10T23:59:59.999Z' })
    expect(parsed.dueDate).toBeInstanceOf(Date)
    expect((parsed.dueDate as Date).toISOString()).toBe('2026-07-10T23:59:59.999Z')
  })

  test('accepts null (no due date)', () => {
    expect(createTaskSchema.parse({ ...base, dueDate: null }).dueDate).toBeNull()
  })

  test('omitting dueDate leaves it undefined', () => {
    expect(createTaskSchema.parse({ ...base }).dueDate).toBeUndefined()
  })

  test('rejects a non-date string', () => {
    expect(createTaskSchema.safeParse({ ...base, dueDate: 'not-a-date' }).success).toBe(false)
  })
})

describe('updateTaskSchema.dueDate (D-2)', () => {
  test('coerces an ISO datetime string to a Date', () => {
    const parsed = updateTaskSchema.parse({ dueDate: '2026-07-10T23:59:59.999Z' })
    expect(parsed.dueDate).toBeInstanceOf(Date)
  })

  test('accepts null to clear the due date', () => {
    expect(updateTaskSchema.parse({ dueDate: null }).dueDate).toBeNull()
  })

  test('rejects a garbage dueDate', () => {
    expect(updateTaskSchema.safeParse({ dueDate: 'garbage' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// PUT /api/tasks/[id] persistence
// ---------------------------------------------------------------------------

const mockTaskFindUnique = mock(() => Promise.resolve({ projectId: 'p1', status: 'BACKLOG' })) as any
const mockTaskUpdate = mock(() => Promise.resolve({ id: 't1', projectId: 'p1', steps: [], status: 'BACKLOG' })) as any
const mockAgentFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    task: { findUnique: mockTaskFindUnique, update: mockTaskUpdate },
    agent: { findUnique: mockAgentFindUnique },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/admin-session', () => ({
  requireAdminSession: mock(() => Promise.resolve(null)) as any,
}))

mock.module('@/lib/csrf', () => ({
  assertSameOrigin: mock(() => undefined) as any,
}))

mock.module('@/lib/server/dispatch', () => ({
  startChain: mock(() => Promise.resolve()) as any,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined) as any,
}))

import { PUT } from '@/app/api/tasks/[id]/route'

function putRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/tasks/t1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 't1' }) } as any

beforeEach(() => {
  mockTaskFindUnique.mockReset()
  mockTaskFindUnique.mockResolvedValue({ projectId: 'p1', status: 'BACKLOG' })
  mockTaskUpdate.mockReset()
  mockTaskUpdate.mockResolvedValue({ id: 't1', projectId: 'p1', steps: [], status: 'BACKLOG' })
})

describe('PUT /api/tasks/[id] — dueDate persistence (D-2)', () => {
  test('persists an ISO dueDate as a Date', async () => {
    const res = await PUT(putRequest({ dueDate: '2026-07-10T23:59:59.999Z' }), params)
    expect(res.status).toBe(200)
    const data = mockTaskUpdate.mock.calls[0][0].data
    expect(data.dueDate).toBeInstanceOf(Date)
    expect((data.dueDate as Date).toISOString()).toBe('2026-07-10T23:59:59.999Z')
  })

  test('clears the due date when dueDate is null', async () => {
    const res = await PUT(putRequest({ dueDate: null }), params)
    expect(res.status).toBe(200)
    expect(mockTaskUpdate.mock.calls[0][0].data.dueDate).toBeNull()
  })

  test('leaves dueDate untouched when the field is omitted', async () => {
    const res = await PUT(putRequest({ title: 'renamed' }), params)
    expect(res.status).toBe(200)
    expect('dueDate' in mockTaskUpdate.mock.calls[0][0].data).toBe(false)
  })
})
