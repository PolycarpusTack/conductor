/**
 * Single-instance dispatch guard (F-3, ADR-0006).
 *
 * The scheduler runs in-process, per-project pollers in a module-level Map with
 * a per-process WORKER_ID (see scheduler.ts / dispatch.ts). Two app instances
 * against the SAME database would each start their own pollers and both select
 * the same unleased steps — the leases (ADR-0002) keep that *safe*, but it is
 * wasteful (both pay for the prelude before one loses) and racy.
 *
 * This module acquires a coarse advisory "scheduler owner" lock in the DB so
 * only one instance dispatches at a time: the winner starts the pollers and
 * heartbeats the lock; a loser stands by and takes over only if the owner's
 * heartbeat goes stale past the TTL.
 *
 * Backed by the `SchedulerLock` model (prisma/schema.prisma, ADR-0006). The
 * guard still FAILS OPEN defensively: if the lock store is ever unavailable it
 * starts the pollers as before and logs one warning — leases remain the real
 * mutual exclusion, so correctness never depends on this guard.
 */

import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('scheduler-lock')

/** Singleton row id — there is exactly one scheduler-owner lock per database. */
export const SCHEDULER_LOCK_ID = 'singleton'

/** How often the owner refreshes its heartbeat (and a standby retries). */
export const SCHEDULER_HEARTBEAT_MS = 60_000

/**
 * A lock whose heartbeat is older than this is presumed dead and can be stolen.
 * A small multiple of the heartbeat so a crashed owner is taken over within a
 * few minutes without flapping on a single missed beat.
 */
export const SCHEDULER_LOCK_TTL_MS = 180_000

/** Per-process owner id, analogous to dispatch.ts WORKER_ID. */
export const SCHEDULER_OWNER_ID = `scheduler-${randomUUID()}`

// ---------------------------------------------------------------------------
// Prisma delegate seam — a minimal structural view of the SchedulerLock
// delegate. Kept as a narrow interface (rather than the full generated type)
// so the store is trivial to mock in tests via mock.module('@/lib/db').
// ---------------------------------------------------------------------------
interface SchedulerLockRow {
  id: string
  ownerId: string
  heartbeatAt: Date
}

interface SchedulerLockDelegate {
  updateMany(args: {
    where: {
      id: string
      ownerId?: string
      OR?: Array<{ ownerId?: string; heartbeatAt?: { lt: Date } }>
    }
    data: { ownerId?: string; heartbeatAt: Date }
  }): Promise<{ count: number }>
  create(args: { data: { id: string; ownerId: string; heartbeatAt: Date } }): Promise<SchedulerLockRow>
  deleteMany(args: { where: { id: string; ownerId: string } }): Promise<{ count: number }>
}

function lockDelegate(): SchedulerLockDelegate {
  return (db as unknown as { schedulerLock: SchedulerLockDelegate }).schedulerLock
}

// ---------------------------------------------------------------------------
// Store — the DB-backed lock operations (guarded-write idiom, same as leaseStep)
// ---------------------------------------------------------------------------

export interface SchedulerLockStore {
  /** Take the lock if free, already ours, or the holder's heartbeat is stale. */
  tryAcquire(ownerId: string, now: Date, ttlMs: number): Promise<boolean>
  /** Refresh our heartbeat; false means we no longer hold the lock. */
  refresh(ownerId: string, now: Date): Promise<boolean>
  /** Release the lock if (and only if) we still hold it. */
  release(ownerId: string): Promise<void>
}

export function createPrismaSchedulerLockStore(): SchedulerLockStore {
  return {
    async tryAcquire(ownerId, now, ttlMs) {
      const staleBefore = new Date(now.getTime() - ttlMs)

      // Take it if we already own it or the current holder's heartbeat is stale.
      // The `where` is the mutual exclusion — a live foreign owner matches
      // neither branch and count stays 0.
      const taken = await lockDelegate().updateMany({
        where: {
          id: SCHEDULER_LOCK_ID,
          OR: [{ ownerId }, { heartbeatAt: { lt: staleBefore } }],
        },
        data: { ownerId, heartbeatAt: now },
      })
      if (taken.count > 0) return true

      // count 0 means either no row yet, or a live foreign owner holds it. Race
      // to create the singleton row — the unique id lets exactly one creator win.
      try {
        await lockDelegate().create({
          data: { id: SCHEDULER_LOCK_ID, ownerId, heartbeatAt: now },
        })
        return true
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') return false // live owner holds it
        throw err
      }
    },

    async refresh(ownerId, now) {
      const result = await lockDelegate().updateMany({
        where: { id: SCHEDULER_LOCK_ID, ownerId },
        data: { heartbeatAt: now },
      })
      return result.count > 0
    },

    async release(ownerId) {
      await lockDelegate().deleteMany({ where: { id: SCHEDULER_LOCK_ID, ownerId } })
    },
  }
}

// ---------------------------------------------------------------------------
// Ownership controller — acquire, heartbeat, stand by, take over, relinquish
// ---------------------------------------------------------------------------

export interface SchedulerOwnership {
  /** True while this instance holds the lock and its pollers should run. */
  owns(): boolean
  /**
   * Run one acquire/refresh cycle. Called on the heartbeat interval; exposed so
   * tests can drive ownership transitions deterministically without waiting.
   */
  tick(): Promise<void>
  /** Stop heartbeating/retrying and release the lock (graceful shutdown). */
  stop(): void
}

export interface StartSchedulerOwnershipOptions {
  /** Called when this instance becomes the dispatch owner (start pollers). Idempotent. */
  onAcquire: () => void | Promise<void>
  /** Called when this instance loses ownership (stop pollers). */
  onRelinquish?: () => void | Promise<void>
  store?: SchedulerLockStore
  ownerId?: string
  ttlMs?: number
  heartbeatMs?: number
  now?: () => Date
}

/**
 * Starts the ownership loop. Immediately attempts to acquire the lock, then
 * keeps a heartbeat/retry interval running:
 *  - owner  → refresh; if refresh fails, relinquish (another instance took over)
 *  - standby → try to acquire; succeeds once the previous owner's lock goes stale
 *
 * If the lock store is ever unavailable (DB hiccup), the guard FAILS OPEN
 * exactly once: it logs a warning and calls `onAcquire` so dispatch still runs.
 * Correctness is unaffected because the leases (ADR-0002) remain the real
 * mutual exclusion.
 */
export async function startSchedulerOwnership(
  opts: StartSchedulerOwnershipOptions,
): Promise<SchedulerOwnership> {
  const store = opts.store ?? createPrismaSchedulerLockStore()
  const ownerId = opts.ownerId ?? SCHEDULER_OWNER_ID
  const ttlMs = opts.ttlMs ?? SCHEDULER_LOCK_TTL_MS
  const heartbeatMs = opts.heartbeatMs ?? SCHEDULER_HEARTBEAT_MS
  const now = opts.now ?? (() => new Date())

  let owning = false
  let warnedStandby = false
  let unavailable = false
  let timer: ReturnType<typeof setInterval> | null = null

  async function attempt() {
    if (unavailable) return

    let acquired: boolean
    try {
      acquired = owning
        ? await store.refresh(ownerId, now())
        : await store.tryAcquire(ownerId, now(), ttlMs)
    } catch (err) {
      // The DB hiccupped or the lock table is missing. Fail OPEN once so the
      // app still dispatches, and disable the guard.
      unavailable = true
      log.warn(
        'scheduler lock unavailable — running WITHOUT the single-instance guard; ' +
          'do NOT run two instances against this DB',
        { ownerId, error: String(err) },
      )
      if (!owning) {
        owning = true
        await opts.onAcquire()
      }
      return
    }

    if (acquired) {
      if (!owning) {
        owning = true
        warnedStandby = false
        log.info('acquired scheduler ownership — this instance dispatches', { ownerId })
        await opts.onAcquire()
      }
      return
    }

    // Not acquired / lost.
    if (owning) {
      owning = false
      log.warn('lost scheduler ownership; another instance took over — this instance will not dispatch', {
        ownerId,
      })
      await opts.onRelinquish?.()
    } else if (!warnedStandby) {
      warnedStandby = true
      log.warn('another scheduler instance owns dispatch; this instance will not dispatch', { ownerId })
    }
  }

  await attempt()

  timer = setInterval(() => {
    void attempt()
  }, heartbeatMs)
  // Don't keep the process alive for the heartbeat alone.
  ;(timer as { unref?: () => void }).unref?.()

  return {
    owns: () => owning,
    tick: attempt,
    stop: () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      // Only touch the DB if we actually hold a real lock (not the fail-open path).
      if (owning && !unavailable) {
        void store.release(ownerId).catch(() => {})
      }
      owning = false
    },
  }
}
