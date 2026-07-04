import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// F-3 single-instance dispatch guard (ADR-0006).
//
// Two app instances against the SAME database must not both dispatch. The
// guard acquires a coarse advisory "scheduler owner" lock; the winner runs the
// pollers, a loser stands by and takes over only if the owner's heartbeat goes
// stale past the TTL.
//
// The lock lives in a SchedulerLock table that is NOT YET in the schema (F-3
// does not own the schema lane), so the production store reaches it through a
// cast. Here we mock '@/lib/db' with a behaviour-compatible in-memory single
// -row `schedulerLock` delegate — this exercises the REAL store code path
// (createPrismaSchedulerLockStore) that runs in production once the model lands.
//
// bun's mock.module registry is shared across files, so this factory exposes a
// focused surface (schedulerLock only, + isPostgresDb) and the module-under-test
// is imported AFTER the mock.
// ---------------------------------------------------------------------------

type LockRow = { id: string; ownerId: string; heartbeatAt: Date }

let lockRow: LockRow | null = null

mock.module('@/lib/db', () => ({
  db: {
    schedulerLock: {
      updateMany: mock(async ({ where, data }: any) => {
        if (!lockRow || lockRow.id !== where.id) return { count: 0 }

        let match = true
        if (where.ownerId !== undefined) match = lockRow.ownerId === where.ownerId
        if (where.OR) {
          match = where.OR.some((cond: any) => {
            if (cond.ownerId !== undefined) return lockRow!.ownerId === cond.ownerId
            if (cond.heartbeatAt?.lt) return lockRow!.heartbeatAt < cond.heartbeatAt.lt
            return false
          })
        }
        if (!match) return { count: 0 }

        if (data.ownerId !== undefined) lockRow.ownerId = data.ownerId
        lockRow.heartbeatAt = data.heartbeatAt
        return { count: 1 }
      }) as any,
      create: mock(async ({ data }: any) => {
        if (lockRow) {
          const err: any = new Error('Unique constraint failed')
          err.code = 'P2002'
          throw err
        }
        lockRow = { ...data }
        return { ...lockRow }
      }) as any,
      deleteMany: mock(async ({ where }: any) => {
        if (lockRow && lockRow.id === where.id && lockRow.ownerId === where.ownerId) {
          lockRow = null
          return { count: 1 }
        }
        return { count: 0 }
      }) as any,
    },
  },
  isPostgresDb: false,
}))

// Import AFTER the mock.
import {
  createPrismaSchedulerLockStore,
  startSchedulerOwnership,
  SCHEDULER_LOCK_TTL_MS,
  type SchedulerLockStore,
} from '../scheduler-lock'

const TTL = SCHEDULER_LOCK_TTL_MS
const BIG_HEARTBEAT = 10_000_000 // large so the interval never fires mid-test

beforeEach(() => {
  lockRow = null
})

// ---------------------------------------------------------------------------
// Store — the real DB-backed lock operations against the in-memory delegate.
// ---------------------------------------------------------------------------
describe('createPrismaSchedulerLockStore', () => {
  test('first caller acquires the free lock; a second is blocked while it is live', async () => {
    const store = createPrismaSchedulerLockStore()
    const t0 = new Date('2026-07-04T00:00:00Z')

    expect(await store.tryAcquire('A', t0, TTL)).toBe(true) // creates the singleton row
    expect(await store.tryAcquire('B', t0, TTL)).toBe(false) // live owner A holds it
    expect(lockRow?.ownerId).toBe('A')
  })

  test('the owner refreshes; a live foreign heartbeat blocks takeover until it goes stale', async () => {
    const store = createPrismaSchedulerLockStore()
    const t0 = new Date('2026-07-04T00:00:00Z')

    await store.tryAcquire('A', t0, TTL)

    // A heartbeats just before the TTL — still live, so B cannot take over.
    const beforeStale = new Date(t0.getTime() + TTL - 1)
    expect(await store.refresh('A', beforeStale)).toBe(true)
    expect(await store.tryAcquire('B', beforeStale, TTL)).toBe(false)

    // Once A's last heartbeat is older than the TTL, B steals the lock.
    const afterStale = new Date(beforeStale.getTime() + TTL + 1)
    expect(await store.tryAcquire('B', afterStale, TTL)).toBe(true)
    expect(lockRow?.ownerId).toBe('B')

    // A's refresh now fails — it no longer owns the lock.
    expect(await store.refresh('A', afterStale)).toBe(false)
  })

  test('release frees the lock only for the current owner', async () => {
    const store = createPrismaSchedulerLockStore()
    const t0 = new Date('2026-07-04T00:00:00Z')

    await store.tryAcquire('A', t0, TTL)
    await store.release('B') // not the owner — no-op
    expect(lockRow?.ownerId).toBe('A')

    await store.release('A')
    expect(lockRow).toBeNull()
    // A fresh caller can now acquire immediately.
    expect(await store.tryAcquire('C', t0, TTL)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ownership controller — acquire, stand by, take over, relinquish, fail open.
// ---------------------------------------------------------------------------
describe('startSchedulerOwnership', () => {
  test('first instance runs; second stands by; standby takes over after TTL expiry', async () => {
    let clock = new Date('2026-07-04T00:00:00Z')
    const now = () => clock

    const store = createPrismaSchedulerLockStore()
    let aStarts = 0
    let aRelinquishes = 0
    let bStarts = 0

    const a = await startSchedulerOwnership({
      store,
      ownerId: 'A',
      now,
      heartbeatMs: BIG_HEARTBEAT,
      onAcquire: () => {
        aStarts++
      },
      onRelinquish: () => {
        aRelinquishes++
      },
    })
    const b = await startSchedulerOwnership({
      store,
      ownerId: 'B',
      now,
      heartbeatMs: BIG_HEARTBEAT,
      onAcquire: () => {
        bStarts++
      },
    })

    // A owns and started its pollers once; B is a cold standby.
    expect(a.owns()).toBe(true)
    expect(aStarts).toBe(1)
    expect(b.owns()).toBe(false)
    expect(bStarts).toBe(0)

    // A dies (stops heartbeating). Advance past the TTL and let B retry.
    clock = new Date(clock.getTime() + TTL + 1)
    await b.tick()

    expect(b.owns()).toBe(true)
    expect(bStarts).toBe(1)

    // A's next heartbeat discovers it lost the lock and relinquishes its pollers.
    await a.tick()
    expect(a.owns()).toBe(false)
    expect(aRelinquishes).toBe(1)

    a.stop()
    b.stop()
  })

  test('fails open when the lock store is unavailable (schema pending): dispatch still starts', async () => {
    let starts = 0
    const unavailableStore: SchedulerLockStore = {
      tryAcquire: async () => {
        throw new Error('no such table: SchedulerLock')
      },
      refresh: async () => false,
      release: async () => {},
    }

    const owner = await startSchedulerOwnership({
      store: unavailableStore,
      ownerId: 'A',
      heartbeatMs: BIG_HEARTBEAT,
      onAcquire: () => {
        starts++
      },
    })

    // Guard disabled → treated as owner so the app dispatches as before.
    expect(owner.owns()).toBe(true)
    expect(starts).toBe(1)

    // Subsequent ticks are inert once marked unavailable (no repeat onAcquire).
    await owner.tick()
    expect(starts).toBe(1)

    owner.stop()
  })
})
