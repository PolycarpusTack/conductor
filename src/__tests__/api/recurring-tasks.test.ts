import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockRecurringFindMany = mock(() => Promise.resolve([])) as any
const mockRecurringFindUnique = mock(() => Promise.resolve(null)) as any
const mockRecurringCreate = mock((args: any) => Promise.resolve({ id: 'rec-1', ...args.data })) as any
const mockRecurringUpdate = mock((args: any) => Promise.resolve({ id: 'rec-1', ...args.data })) as any
const mockRecurringDelete = mock(() => Promise.resolve({})) as any
const mockTemplateFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    recurringTask: {
      findMany: mockRecurringFindMany,
      findUnique: mockRecurringFindUnique,
      create: mockRecurringCreate,
      update: mockRecurringUpdate,
      delete: mockRecurringDelete,
    },
    taskTemplate: { findUnique: mockTemplateFindUnique },
  },
  isPostgresDb: false,
}))

beforeEach(() => {
  for (const m of [
    mockRecurringFindMany, mockRecurringFindUnique, mockRecurringCreate,
    mockRecurringUpdate, mockRecurringDelete, mockTemplateFindUnique,
  ]) m.mockReset()
  mockRecurringFindMany.mockResolvedValue([])
  mockRecurringFindUnique.mockResolvedValue(null)
  mockRecurringCreate.mockImplementation((args: any) => Promise.resolve({ id: 'rec-1', ...args.data }))
  mockRecurringUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'rec-1', ...args.data }))
  mockRecurringDelete.mockResolvedValue({})
  mockTemplateFindUnique.mockResolvedValue(null)
  setSession(ADMIN_SESSION)
})

const listParams = { params: Promise.resolve({ id: 'p-1' }) }
const itemParams = { params: Promise.resolve({ id: 'p-1', recurringId: 'rec-1' }) }

describe('POST /api/projects/[id]/recurring-tasks', () => {
  test('creates a recurrence and computes a future nextRunAt', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { POST } = await import('@/app/api/projects/[id]/recurring-tasks/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks', {
        method: 'POST',
        body: { name: 'Weekly standup', taskTemplateId: 'tt-1', cadence: 'weekly', dayOfWeek: 1, timeOfDay: '09:00' },
      }),
      listParams,
    )
    expect(res.status).toBe(200)
    const data = mockRecurringCreate.mock.calls[0][0].data
    expect(data.projectId).toBe('p-1')
    expect(data.nextRunAt.getTime()).toBeGreaterThan(Date.now())
    expect(data.nextRunAt.getDay()).toBe(1)
  })

  test('rejects a weekly cadence without dayOfWeek', async () => {
    const { POST } = await import('@/app/api/projects/[id]/recurring-tasks/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks', {
        method: 'POST',
        body: { name: 'Bad', taskTemplateId: 'tt-1', cadence: 'weekly', timeOfDay: '09:00' },
      }),
      listParams,
    )
    expect(res.status).toBe(400)
    expect(mockRecurringCreate).not.toHaveBeenCalled()
  })

  test('rejects a template from another project', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'other' })
    const { POST } = await import('@/app/api/projects/[id]/recurring-tasks/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks', {
        method: 'POST',
        body: { name: 'Cross', taskTemplateId: 'tt-x', cadence: 'daily', timeOfDay: '09:00' },
      }),
      listParams,
    )
    expect(res.status).toBe(400)
    expect(mockRecurringCreate).not.toHaveBeenCalled()
  })
})

describe('PUT /api/projects/[id]/recurring-tasks/[recurringId]', () => {
  const existing = {
    id: 'rec-1', projectId: 'p-1', cadence: 'daily',
    dayOfWeek: null, dayOfMonth: null, timeOfDay: '09:00', enabled: true,
  }

  test('recomputes nextRunAt when cadence fields change', async () => {
    mockRecurringFindUnique.mockResolvedValue(existing)
    const { PUT } = await import('@/app/api/projects/[id]/recurring-tasks/[recurringId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks/rec-1', {
        method: 'PUT',
        body: { cadence: 'weekly', dayOfWeek: 3 },
      }),
      itemParams,
    )
    expect(res.status).toBe(200)
    const data = mockRecurringUpdate.mock.calls[0][0].data
    expect(data.nextRunAt.getDay()).toBe(3)
  })

  test('leaves nextRunAt alone for a pure enable/disable toggle', async () => {
    mockRecurringFindUnique.mockResolvedValue(existing)
    const { PUT } = await import('@/app/api/projects/[id]/recurring-tasks/[recurringId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks/rec-1', {
        method: 'PUT',
        body: { enabled: false },
      }),
      itemParams,
    )
    expect(res.status).toBe(200)
    expect(mockRecurringUpdate.mock.calls[0][0].data.nextRunAt).toBeUndefined()
  })

  test('404 for a recurrence in another project', async () => {
    mockRecurringFindUnique.mockResolvedValue({ ...existing, projectId: 'other' })
    const { PUT } = await import('@/app/api/projects/[id]/recurring-tasks/[recurringId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks/rec-1', {
        method: 'PUT',
        body: { enabled: false },
      }),
      itemParams,
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/projects/[id]/recurring-tasks/[recurringId]', () => {
  test('deletes a recurrence in this project', async () => {
    mockRecurringFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { DELETE } = await import('@/app/api/projects/[id]/recurring-tasks/[recurringId]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/p-1/recurring-tasks/rec-1', { method: 'DELETE' }),
      itemParams,
    )
    expect(res.status).toBe(200)
    expect(mockRecurringDelete).toHaveBeenCalled()
  })
})
