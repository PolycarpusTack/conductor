import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// B-2 Claim reaper — expired Model-B claims go back to BACKLOG.
//
// Uses a small in-memory task store behind the '@/lib/db' mock so the reaper
// and the /api/agent/next route are exercised against the same state:
// - reaper returns an expired claim to BACKLOG (agentId + claimExpiresAt
//   cleared) with a durable 'task_claim_reaped' activity entry + broadcast
// - reaper NEVER touches dispatch-driven IN_PROGRESS tasks (claimExpiresAt
//   null) or unexpired claims
// - reaper skips tasks with chain steps still in flight
// - renewal race: a claim renewed between the sweep's read and write is left
//   alone (guarded updateMany)
// - /api/agent/next re-offers a reaped task (real route + real memory module)
//
// Mocked modules: '@/lib/db', '@/lib/server/realtime', and a behaviour-
// compatible '@/lib/server/api-keys' factory — bun:test module mocks persist
// across files, so dispatch/memory (which have real unit tests later in the
// run) are NOT module-mocked here (see dispatch-logic.test.ts note).
// ---------------------------------------------------------------------------

type StoreTask = {
  id: string
  title: string
  description: string | null
  notes: string | null
  output: string | null
  projectId: string
  agentId: string | null
  status: string
  priority: string
  order: number
  deletedAt: Date | null
  archivedAt: Date | null
  claimExpiresAt: Date | null
  startedAt: Date | null
  completedAt: Date | null
  steps: Array<{ id: string; status: string }>
}

let tasks: StoreTask[] = []
let activityRows: any[] = []
// Test hook for the renewal race: when set, the first findMany renews the
// task's claim AFTER snapshotting the candidate row (simulating a heartbeat
// landing between the reaper's read and its guarded write).
let renewDuringFindId: string | null = null

const PRIORITY_RANK: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

function matchesWhere(t: StoreTask, where: any): boolean {
  if (where.id !== undefined && t.id !== where.id) return false
  if (where.projectId !== undefined && t.projectId !== where.projectId) return false
  if (where.status !== undefined && t.status !== where.status) return false
  if (where.agentId !== undefined && t.agentId !== where.agentId) return false
  if (where.deletedAt !== undefined && t.deletedAt !== where.deletedAt) return false
  if (where.archivedAt !== undefined && t.archivedAt !== where.archivedAt) return false
  if (where.claimExpiresAt !== undefined) {
    const c = where.claimExpiresAt
    if (c === null) {
      if (t.claimExpiresAt !== null) return false
    } else {
      if (c.not === null && t.claimExpiresAt == null) return false
      if (c.lt !== undefined && !(t.claimExpiresAt != null && t.claimExpiresAt < c.lt)) return false
    }
  }
  if (where.steps?.none !== undefined) {
    if (t.steps.some((s) => s.status === where.steps.none.status)) return false
  }
  return true
}

function sortTasks(list: StoreTask[]): StoreTask[] {
  return [...list].sort(
    (a, b) => (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0) || a.order - b.order,
  )
}

const broadcasts: Array<{ projectId: string; event: string; payload: any }> = []

mock.module('@/lib/db', () => ({
  db: {
    task: {
      findMany: mock(async ({ where }: any) => {
        const rows = tasks.filter((t) => matchesWhere(t, where)).map((t) => ({ ...t }))
        if (renewDuringFindId) {
          const target = tasks.find((t) => t.id === renewDuringFindId)
          if (target) target.claimExpiresAt = new Date(Date.now() + 15 * 60_000)
          renewDuringFindId = null
        }
        return rows
      }) as any,
      findFirst: mock(async ({ where }: any) => {
        const hit = sortTasks(tasks.filter((t) => matchesWhere(t, where)))[0]
        return hit ? { ...hit, project: { name: 'Project One' } } : null
      }) as any,
      findUnique: mock(async ({ where }: any) => {
        const hit = tasks.find((t) => t.id === where.id)
        return hit ? { ...hit, agent: null, project: { id: hit.projectId, name: 'Project One' } } : null
      }) as any,
      updateMany: mock(async ({ where, data }: any) => {
        const hits = tasks.filter((t) => matchesWhere(t, where))
        for (const t of hits) Object.assign(t, data)
        return { count: hits.length }
      }) as any,
      update: mock(async ({ where, data }: any) => {
        const hit = tasks.find((t) => t.id === where.id)
        if (!hit) throw new Error('not found')
        Object.assign(hit, data)
        return { ...hit }
      }) as any,
    },
    agent: {
      // Real api-keys auth path: hashed-key lookup resolves our test agent.
      findUnique: mock(() =>
        Promise.resolve({ id: 'agent-1', name: 'Agent One', emoji: '🤖', projectId: 'proj-1' }),
      ) as any,
      update: mock(() => Promise.resolve({})) as any,
    },
    agentMemory: {
      findMany: mock(() => Promise.resolve([])) as any,
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
  broadcastProjectEvent: mock((projectId: string, event: string, payload: any) => {
    broadcasts.push({ projectId, event, payload })
  }) as any,
  createRealtimeToken: mock(() => null) as any,
  isRealtimeConfigured: mock(() => false) as any,
}))

// NOTE: bun's mock.module registry is shared across test files in a run, so
// this factory must expose the full export surface of the real module with
// behaviour-compatible implementations (mirrors agent-events-route.test.ts).
// Registered here because earlier agent-* route tests leave their own
// api-keys mock behind (resolveAgentByApiKey defaulting to null).
mock.module('@/lib/server/api-keys', () => ({
  extractAgentApiKey: (request: Request, body?: Record<string, unknown> | null) => {
    const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    if (bearer) return bearer
    const headerKey = request.headers.get('x-agent-key')?.trim()
    if (headerKey) return headerKey
    return typeof body?.api_key === 'string' ? body.api_key.trim() || null : null
  },
  extractBearerToken: (request: Request) => {
    const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
    return match?.[1]?.trim() || null
  },
  resolveAgentByApiKey: mock(() =>
    Promise.resolve({ id: 'agent-1', name: 'Agent One', emoji: '🤖', projectId: 'proj-1' }),
  ) as any,
  buildApiKeyPreview: (rawKey: string) => `${rawKey.slice(0, 12)}...${rawKey.slice(-6)}`,
  createAgentApiKey: () => ({ rawKey: 'mock', hash: 'mock', preview: 'mock' }),
  createProjectApiKey: () => ({ rawKey: 'mock', hash: 'mock', preview: 'mock' }),
  getLegacyApiKeyStatus: () => Promise.resolve({ projectsWithPlaintext: 0, agentsWithPlaintext: 0, totalWithPlaintext: 0 }),
  migrateLegacyApiKeys: () => Promise.resolve({ projects: 0, agents: 0 }),
}))

// Import AFTER mocks
import { reapExpiredClaims } from '../claim-reaper'
import { resetHeartbeatDebounce } from '../agent-helpers'
import { GET as getNextTask } from '@/app/api/agent/next/route'

function makeTask(overrides: Partial<StoreTask>): StoreTask {
  return {
    id: 'task-1',
    title: 'A task',
    description: null,
    notes: null,
    output: null,
    projectId: 'proj-1',
    agentId: null,
    status: 'BACKLOG',
    priority: 'MEDIUM',
    order: 0,
    deletedAt: null,
    archivedAt: null,
    claimExpiresAt: null,
    startedAt: null,
    completedAt: null,
    steps: [],
    ...overrides,
  }
}

const PAST = () => new Date(Date.now() - 60_000)
const FUTURE = () => new Date(Date.now() + 10 * 60_000)

beforeEach(() => {
  tasks = []
  activityRows = []
  broadcasts.length = 0
  renewDuringFindId = null
  resetHeartbeatDebounce()
})

describe('reapExpiredClaims', () => {
  test('returns an expired claim to BACKLOG with a task_claim_reaped activity entry and broadcast', async () => {
    tasks.push(
      makeTask({
        id: 'task-expired',
        status: 'IN_PROGRESS',
        agentId: 'agent-2',
        claimExpiresAt: PAST(),
        startedAt: new Date(),
      }),
    )

    const reaped = await reapExpiredClaims()

    expect(reaped).toBe(1)
    const t = tasks[0]
    expect(t.status).toBe('BACKLOG')
    expect(t.agentId).toBeNull()
    expect(t.claimExpiresAt).toBeNull()

    const entry = activityRows.find((a) => a.action === 'task_claim_reaped')
    expect(entry).toBeDefined()
    expect(entry.taskId).toBe('task-expired')
    expect(entry.projectId).toBe('proj-1')
    expect(entry.agentId).toBe('agent-2')
    expect(JSON.parse(entry.details)).toMatchObject({ previousAgentId: 'agent-2' })

    // Board update mirrors the status-change convention: 'task-moved'
    const moved = broadcasts.find((b) => b.event === 'task-moved')
    expect(moved).toBeDefined()
    expect(moved!.projectId).toBe('proj-1')
    expect(moved!.payload.taskId).toBe('task-expired')
  })

  test('never touches dispatch-driven IN_PROGRESS tasks (no claimExpiresAt) or unexpired claims', async () => {
    tasks.push(
      makeTask({ id: 'task-dispatch', status: 'IN_PROGRESS', agentId: 'agent-9', claimExpiresAt: null }),
      makeTask({ id: 'task-fresh', status: 'IN_PROGRESS', agentId: 'agent-2', claimExpiresAt: FUTURE() }),
    )

    const reaped = await reapExpiredClaims()

    expect(reaped).toBe(0)
    expect(tasks[0].status).toBe('IN_PROGRESS')
    expect(tasks[0].agentId).toBe('agent-9')
    expect(tasks[1].status).toBe('IN_PROGRESS')
    expect(tasks[1].claimExpiresAt).not.toBeNull()
    expect(activityRows).toHaveLength(0)
    expect(broadcasts).toHaveLength(0)
  })

  test('skips an expired claim while chain steps are still in flight', async () => {
    tasks.push(
      makeTask({
        id: 'task-chained',
        status: 'IN_PROGRESS',
        agentId: 'agent-2',
        claimExpiresAt: PAST(),
        steps: [{ id: 'step-1', status: 'active' }],
      }),
    )

    const reaped = await reapExpiredClaims()

    expect(reaped).toBe(0)
    expect(tasks[0].status).toBe('IN_PROGRESS')
    expect(activityRows).toHaveLength(0)
  })

  test('renewal race: a claim renewed between read and write is not reaped', async () => {
    tasks.push(
      makeTask({ id: 'task-racy', status: 'IN_PROGRESS', agentId: 'agent-2', claimExpiresAt: PAST() }),
    )
    renewDuringFindId = 'task-racy' // heartbeat lands right after the sweep's read

    const reaped = await reapExpiredClaims()

    expect(reaped).toBe(0)
    expect(tasks[0].status).toBe('IN_PROGRESS')
    expect(tasks[0].agentId).toBe('agent-2')
    expect(activityRows).toHaveLength(0)
    expect(broadcasts).toHaveLength(0)
  })
})

describe('/api/agent/next re-offers a reaped task', () => {
  function nextRequest() {
    return new Request('http://localhost/api/agent/next', {
      headers: { 'x-agent-key': 'test-agent-key' },
    })
  }

  test('task invisible while claimed by a crashed agent, offered again after the reaper sweep', async () => {
    tasks.push(
      makeTask({
        id: 'task-stranded',
        status: 'IN_PROGRESS',
        agentId: 'agent-crashed',
        claimExpiresAt: PAST(),
      }),
    )

    const before = await getNextTask(nextRequest(), {} as never)
    const beforeBody = await before.json()
    expect(beforeBody.task).toBeNull()

    await reapExpiredClaims()

    const after = await getNextTask(nextRequest(), {} as never)
    const afterBody = await after.json()
    expect(afterBody.task).not.toBeNull()
    expect(afterBody.task.id).toBe('task-stranded')
    expect(afterBody.suggestion).toContain('claim')
  })
})
