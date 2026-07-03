import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// B-3 — when the stale sweep flips a daemon to 'stale', its step leases are
// released immediately (not after the 10-min LEASE_TIMEOUT_MS), with a
// 'lease_reclaimed' audit row mirroring daemon-dispatch's existing convention.
//
// Stateful in-memory daemon/step stores behind the '@/lib/db' mock so we can
// also prove the reclaimed step is immediately re-dispatchable.
// ---------------------------------------------------------------------------

type StoreDaemon = {
  id: string
  status: string
  lastSeenAt: Date | null
  hostname: string
  workspaceId: string
  capabilities: string
}

type StoreStep = {
  id: string
  taskId: string
  agentId: string | null
  status: string
  leasedBy: string | null
  leasedAt: Date | null
}

let daemons: StoreDaemon[] = []
let steps: StoreStep[] = []
let activityRows: any[] = []

const mockTaskStepFindMany = mock(async ({ where }: any) =>
  steps
    .filter(
      (s) =>
        (where.leasedBy?.in === undefined || where.leasedBy.in.includes(s.leasedBy)) &&
        (where.status === undefined || s.status === where.status),
    )
    .map((s) => ({ ...s, task: { projectId: 'proj-1' } })),
) as any

const mockTaskStepUpdateMany = mock(async ({ where, data }: any) => {
  const hits = steps.filter((s) => {
    if (where.id !== undefined && s.id !== where.id) return false
    if (typeof where.leasedBy === 'string' && s.leasedBy !== where.leasedBy) return false
    if (where.OR) {
      const leaseExpiredOrFree = where.OR.some((clause: any) => {
        if ('leasedBy' in clause) return s.leasedBy === clause.leasedBy
        if (clause.leasedAt?.lt) return s.leasedAt != null && s.leasedAt < clause.leasedAt.lt
        return false
      })
      if (!leaseExpiredOrFree) return false
    }
    return true
  })
  for (const s of hits) Object.assign(s, data)
  return { count: hits.length }
}) as any

const mockDaemonFindMany = mock(async ({ where }: any) => {
  let list = daemons.filter((d) => d.status === (where.status ?? d.status))
  if (where.lastSeenAt?.lt !== undefined) {
    list = list.filter((d) => d.lastSeenAt != null && d.lastSeenAt < where.lastSeenAt.lt)
  }
  if (where.workspaceId !== undefined) {
    list = list.filter((d) => d.workspaceId === where.workspaceId)
  }
  return list.map((d) => ({ ...d }))
}) as any

const mockDaemonUpdateMany = mock(async ({ where, data }: any) => {
  const hits = daemons.filter(
    (d) =>
      (where.id?.in === undefined || where.id.in.includes(d.id)) &&
      (where.status === undefined || d.status === where.status),
  )
  for (const d of hits) Object.assign(d, data)
  return { count: hits.length }
}) as any

mock.module('@/lib/db', () => ({
  db: {
    daemon: {
      findMany: mockDaemonFindMany,
      updateMany: mockDaemonUpdateMany,
      update: mock(() => Promise.resolve({})) as any,
      findUnique: mock(() => Promise.resolve(null)) as any,
    },
    taskStep: {
      findMany: mockTaskStepFindMany,
      updateMany: mockTaskStepUpdateMany,
      findUnique: mock(async ({ where }: any) => {
        const s = steps.find((x) => x.id === where.id)
        if (!s) return null
        return {
          ...s,
          agent: { runtime: { adapter: 'anthropic' } },
          task: { projectId: 'proj-1', project: { workspaceId: 'ws-1' } },
        }
      }) as any,
    },
    task: {
      findUnique: mock(() => Promise.resolve({ runtimeOverride: null })) as any,
    },
    activityLog: {
      create: mock(async ({ data }: any) => {
        activityRows.push(data)
        return data
      }) as any,
    },
  },
  isPostgresDb: false,
}))

mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => undefined) as any,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))

// Import AFTER mocks — real modules under test
import { markStaleDaemons } from '../daemon-auth'
import { dispatchStepToDaemon } from '../daemon-dispatch'

const OLD = () => new Date(Date.now() - 120_000) // 2 min ago — past the 30s threshold
const FRESH = () => new Date(Date.now() - 1_000)

beforeEach(() => {
  daemons = []
  steps = []
  activityRows = []
  mockTaskStepFindMany.mockClear()
  mockTaskStepUpdateMany.mockClear()
  mockDaemonFindMany.mockClear()
  mockDaemonUpdateMany.mockClear()
})

describe('markStaleDaemons — reclaim-on-stale (B-3)', () => {
  test('stale sweep reclaims the stale daemon leases with a lease_reclaimed audit row', async () => {
    daemons.push(
      { id: 'd-stale', status: 'online', lastSeenAt: OLD(), hostname: 'dead-host', workspaceId: 'ws-1', capabilities: '{}' },
      { id: 'd-live', status: 'online', lastSeenAt: FRESH(), hostname: 'live-host', workspaceId: 'ws-1', capabilities: '{}' },
    )
    steps.push(
      { id: 'step-stale', taskId: 'task-1', agentId: 'agent-1', status: 'active', leasedBy: 'd-stale', leasedAt: OLD() },
      { id: 'step-live', taskId: 'task-2', agentId: 'agent-2', status: 'active', leasedBy: 'd-live', leasedAt: FRESH() },
    )

    await markStaleDaemons(30_000)

    // Daemon flips to stale; the live one stays online.
    expect(daemons.find((d) => d.id === 'd-stale')!.status).toBe('stale')
    expect(daemons.find((d) => d.id === 'd-live')!.status).toBe('online')

    // The stale daemon's lease is released immediately...
    const reclaimed = steps.find((s) => s.id === 'step-stale')!
    expect(reclaimed.leasedBy).toBeNull()
    expect(reclaimed.leasedAt).toBeNull()

    // ...while the online daemon's lease is untouched.
    const untouched = steps.find((s) => s.id === 'step-live')!
    expect(untouched.leasedBy).toBe('d-live')
    expect(untouched.leasedAt).not.toBeNull()

    // Audit row mirrors daemon-dispatch's lease_reclaimed convention.
    const audits = activityRows.filter((a) => a.action === 'lease_reclaimed')
    expect(audits).toHaveLength(1)
    expect(audits[0].taskId).toBe('task-1')
    expect(audits[0].agentId).toBe('agent-1')
    expect(audits[0].projectId).toBe('proj-1')
    expect(JSON.parse(audits[0].details)).toMatchObject({
      stepId: 'step-stale',
      previousLeaseholder: 'd-stale',
      reason: 'daemon_stale',
    })
  })

  test('no stale daemons — no lease sweep, no daemon writes', async () => {
    daemons.push(
      { id: 'd-live', status: 'online', lastSeenAt: FRESH(), hostname: 'live-host', workspaceId: 'ws-1', capabilities: '{}' },
    )
    steps.push(
      { id: 'step-live', taskId: 'task-2', agentId: 'agent-2', status: 'active', leasedBy: 'd-live', leasedAt: FRESH() },
    )

    await markStaleDaemons(30_000)

    expect(daemons[0].status).toBe('online')
    expect(steps[0].leasedBy).toBe('d-live')
    expect(mockDaemonUpdateMany).not.toHaveBeenCalled()
    expect(mockTaskStepFindMany).not.toHaveBeenCalled()
    expect(activityRows).toHaveLength(0)
  })

  test('a reclaimed step is immediately re-dispatchable to another daemon', async () => {
    daemons.push(
      { id: 'd-stale', status: 'online', lastSeenAt: OLD(), hostname: 'dead-host', workspaceId: 'ws-1', capabilities: '{}' },
      {
        id: 'd-backup',
        status: 'online',
        lastSeenAt: FRESH(),
        hostname: 'backup-host',
        workspaceId: 'ws-1',
        capabilities: JSON.stringify({ 'claude-code': { version: '1.0' } }),
      },
    )
    steps.push(
      { id: 'step-stale', taskId: 'task-1', agentId: 'agent-1', status: 'active', leasedBy: 'd-stale', leasedAt: FRESH() },
    )

    // Before the sweep the fresh lease blocks re-dispatch.
    const blocked = await dispatchStepToDaemon('step-stale')
    expect(blocked.dispatched).toBe(false)

    await markStaleDaemons(30_000)

    const result = await dispatchStepToDaemon('step-stale')
    expect(result.dispatched).toBe(true)
    expect(result.daemonId).toBe('d-backup')
    expect(steps[0].leasedBy).toBe('d-backup')
  })
})
