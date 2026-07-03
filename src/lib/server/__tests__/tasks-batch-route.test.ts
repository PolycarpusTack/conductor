import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHash } from 'crypto'

// ---------------------------------------------------------------------------
// Test target: src/app/api/tasks/batch/route.ts (POST)
//
// D-3-T1: bulk move / archive / soft-delete in one transaction, project-scoped
// auth, per-id idempotency (already-deleted/archived/no-op → skipped).
// ---------------------------------------------------------------------------

import { setSession, ADMIN_SESSION } from '../../../__tests__/helpers/auth'

// Scoped write key bound to proj-1 (B-4). A batch whose tasks live in proj-2
// must be rejected 403.
const RAW_WRITE_KEY = 'c'.repeat(64)
const WRITE_KEY_RECORD = {
  id: 'key-w1',
  prefix: RAW_WRITE_KEY.slice(0, 8),
  keyHash: createHash('sha256').update(RAW_WRITE_KEY).digest('hex'),
  label: 'webhook',
  scopes: '["write"]',
  projectId: 'proj-1',
  createdAt: new Date(),
  lastUsedAt: null,
  revokedAt: null,
}

const mockTaskFindMany = mock(() => Promise.resolve([])) as any
const mockTxTaskUpdateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockTxTaskStepUpdateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockActivityLogCreate = mock(() => Promise.resolve({})) as any

const txShape = {
  task: { updateMany: mockTxTaskUpdateMany },
  taskStep: { updateMany: mockTxTaskStepUpdateMany },
}
const mockTransaction = mock((cb: (tx: typeof txShape) => unknown) => cb(txShape)) as any

mock.module('@/lib/db', () => ({
  db: {
    $transaction: mockTransaction,
    task: { findMany: mockTaskFindMany },
    apiKey: {
      findUnique: ({ where }: { where: { prefix: string } }) =>
        where.prefix === WRITE_KEY_RECORD.prefix ? Promise.resolve(WRITE_KEY_RECORD) : Promise.resolve(null),
      update: () => Promise.resolve(WRITE_KEY_RECORD),
    },
    activityLog: { create: mockActivityLogCreate },
  },
  isPostgresDb: false,
}))

const mockStartChain = mock(() => Promise.resolve()) as any
mock.module('@/lib/server/dispatch', () => ({
  normalizeDagEdges: mock(() => Promise.resolve()) as any,
  startChain: mockStartChain,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => Promise.resolve()) as any,
}))

import { POST } from '@/app/api/tasks/batch/route'

beforeEach(() => {
  setSession(ADMIN_SESSION)
  mockTaskFindMany.mockReset()
  mockTaskFindMany.mockResolvedValue([])
  mockTxTaskUpdateMany.mockReset()
  mockTxTaskUpdateMany.mockResolvedValue({ count: 0 })
  mockTxTaskStepUpdateMany.mockReset()
  mockTxTaskStepUpdateMany.mockResolvedValue({ count: 0 })
  mockTransaction.mockReset()
  mockTransaction.mockImplementation((cb: (tx: typeof txShape) => unknown) => cb(txShape))
  mockStartChain.mockReset()
  mockStartChain.mockResolvedValue(undefined)
  mockActivityLogCreate.mockReset()
  mockActivityLogCreate.mockResolvedValue({})
})

function makeRequest(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost', origin: 'http://localhost', ...headers },
    body: JSON.stringify(body),
  })
}

const live = (id: string, projectId = 'proj-1', status = 'BACKLOG') => ({
  id,
  projectId,
  status,
  deletedAt: null,
  archivedAt: null,
})

describe('POST /api/tasks/batch — auth & validation', () => {
  test('401 with an invalid API key (no session fallback)', async () => {
    // A presented bearer token is authoritative — an unknown/invalid key is
    // rejected 401 without falling back to the session. Deterministic across
    // the full suite regardless of the shared admin-session mock's state.
    setSession(null)
    const res = await POST(
      makeRequest({ action: 'archive', taskIds: ['t-1'] }, { Authorization: `Bearer ${'0'.repeat(64)}` }),
      { params: Promise.resolve({}) } as any,
    )
    expect(res.status).toBe(401)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  test('400 on empty taskIds', async () => {
    const res = await POST(makeRequest({ action: 'archive', taskIds: [] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(mockTaskFindMany).not.toHaveBeenCalled()
  })

  test('400 on an invalid status', async () => {
    const res = await POST(makeRequest({ action: 'move', taskIds: ['t-1'], status: 'NOPE' }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
  })

  test('400 when move is missing a status', async () => {
    const res = await POST(makeRequest({ action: 'move', taskIds: ['t-1'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/batch — move', () => {
  test('moves N tasks to the target status in one updateMany', async () => {
    mockTaskFindMany
      .mockResolvedValueOnce([live('t-1'), live('t-2'), live('t-3')])
      .mockResolvedValueOnce([{ id: 't-1', status: 'DONE' }, { id: 't-2', status: 'DONE' }, { id: 't-3', status: 'DONE' }])
    const res = await POST(makeRequest({ action: 'move', taskIds: ['t-1', 't-2', 't-3'], status: 'DONE' }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-1', 't-2', 't-3'])
    expect(body.skipped).toEqual([])
    expect(mockTxTaskUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockTxTaskUpdateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['t-1', 't-2', 't-3'] } }, data: { status: 'DONE' } })
  })

  test('a task already at the target status is skipped (no-op)', async () => {
    mockTaskFindMany
      .mockResolvedValueOnce([live('t-1', 'proj-1', 'DONE'), live('t-2', 'proj-1', 'BACKLOG')])
      .mockResolvedValueOnce([{ id: 't-2', status: 'DONE' }])
    const res = await POST(makeRequest({ action: 'move', taskIds: ['t-1', 't-2'], status: 'DONE' }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-2'])
    expect(body.skipped).toEqual(['t-1'])
    expect(mockTxTaskUpdateMany.mock.calls[0][0].where.id.in).toEqual(['t-2'])
  })
})

describe('POST /api/tasks/batch — archive', () => {
  test('archives N tasks (sets archivedAt)', async () => {
    mockTaskFindMany.mockResolvedValueOnce([live('t-1'), live('t-2')])
    const res = await POST(makeRequest({ action: 'archive', taskIds: ['t-1', 't-2'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-1', 't-2'])
    const call = mockTxTaskUpdateMany.mock.calls[0][0]
    expect(call.where.id.in).toEqual(['t-1', 't-2'])
    expect(call.data.archivedAt).toBeInstanceOf(Date)
  })

  test('an already-archived task is skipped', async () => {
    mockTaskFindMany.mockResolvedValueOnce([{ ...live('t-1'), archivedAt: new Date() }, live('t-2')])
    const res = await POST(makeRequest({ action: 'archive', taskIds: ['t-1', 't-2'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-2'])
    expect(body.skipped).toEqual(['t-1'])
  })
})

describe('POST /api/tasks/batch — delete', () => {
  test('soft-deletes N tasks and releases their step leases', async () => {
    mockTaskFindMany.mockResolvedValueOnce([live('t-1'), live('t-2')])
    const res = await POST(makeRequest({ action: 'delete', taskIds: ['t-1', 't-2'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-1', 't-2'])
    expect(mockTxTaskUpdateMany.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
    expect(mockTxTaskStepUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockTxTaskStepUpdateMany.mock.calls[0][0]).toEqual({ where: { taskId: { in: ['t-1', 't-2'] } }, data: { leasedBy: null, leasedAt: null } })
  })

  test('an already-deleted id is skipped, not an error', async () => {
    mockTaskFindMany.mockResolvedValueOnce([{ ...live('t-1'), deletedAt: new Date() }, live('t-2')])
    const res = await POST(makeRequest({ action: 'delete', taskIds: ['t-1', 't-2'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-2'])
    expect(body.skipped).toEqual(['t-1'])
    expect(mockTxTaskUpdateMany.mock.calls[0][0].where.id.in).toEqual(['t-2'])
  })

  test('an unknown id is reported as skipped', async () => {
    mockTaskFindMany.mockResolvedValueOnce([live('t-1')])
    const res = await POST(makeRequest({ action: 'delete', taskIds: ['t-1', 'ghost'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.affected).toEqual(['t-1'])
    expect(body.skipped).toEqual(['ghost'])
  })

  test('all-skipped batch runs no transaction', async () => {
    mockTaskFindMany.mockResolvedValueOnce([{ ...live('t-1'), deletedAt: new Date() }])
    const res = await POST(makeRequest({ action: 'delete', taskIds: ['t-1'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(200)
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/batch — project scoping', () => {
  test('400 when the batch spans two projects', async () => {
    mockTaskFindMany.mockResolvedValueOnce([live('t-1', 'proj-1'), live('t-2', 'proj-2')])
    const res = await POST(makeRequest({ action: 'archive', taskIds: ['t-1', 't-2'] }), { params: Promise.resolve({}) } as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/same project/i)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  test('a key bound to proj-1 acting on proj-2 tasks is rejected 403', async () => {
    setSession(null)
    mockTaskFindMany.mockResolvedValueOnce([live('t-1', 'proj-2'), live('t-2', 'proj-2')])
    const res = await POST(
      makeRequest({ action: 'archive', taskIds: ['t-1', 't-2'] }, { Authorization: `Bearer ${RAW_WRITE_KEY}` }),
      { params: Promise.resolve({}) } as any,
    )
    expect(res.status).toBe(403)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  test('a key bound to proj-1 acting on proj-1 tasks succeeds', async () => {
    setSession(null)
    mockTaskFindMany.mockResolvedValueOnce([live('t-1', 'proj-1'), live('t-2', 'proj-1')])
    const res = await POST(
      makeRequest({ action: 'archive', taskIds: ['t-1', 't-2'] }, { Authorization: `Bearer ${RAW_WRITE_KEY}` }),
      { params: Promise.resolve({}) } as any,
    )
    expect(res.status).toBe(200)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
