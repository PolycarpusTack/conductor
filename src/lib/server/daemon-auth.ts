import { createHash, randomBytes } from 'crypto'

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('daemon-auth')

export interface DaemonAuthResult {
  id: string
  workspaceId: string
  hostname: string
  status: string
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildTokenPreview(rawToken: string): string {
  return `${rawToken.slice(0, 10)}...${rawToken.slice(-6)}`
}

export function generateDaemonToken(daemonId: string) {
  const secret = randomBytes(32).toString('hex')
  const rawToken = `cd_daemon.${daemonId}.${secret}`

  return {
    rawToken,
    hash: hashToken(rawToken),
    preview: buildTokenPreview(rawToken),
  }
}

export function extractDaemonToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export async function resolveDaemonByToken(rawToken: string): Promise<DaemonAuthResult | null> {
  const hashed = hashToken(rawToken)

  const daemon = await db.daemon.findUnique({
    where: { tokenHash: hashed },
    select: {
      id: true,
      workspaceId: true,
      hostname: true,
      status: true,
    },
  })

  return daemon || null
}

export async function updateDaemonHeartbeat(daemonId: string) {
  await db.daemon.update({
    where: { id: daemonId },
    data: {
      lastSeenAt: new Date(),
      status: 'online',
    },
  })
}

export async function markDaemonOffline(daemonId: string) {
  await db.daemon.update({
    where: { id: daemonId },
    data: {
      status: 'offline',
      lastSeenAt: new Date(),
    },
  }).catch(() => {
    // Daemon may have been deleted
  })
}

export async function markStaleDaemons(thresholdMs: number = 30_000) {
  const cutoff = new Date(Date.now() - thresholdMs)

  await db.daemon.updateMany({
    where: {
      status: 'online',
      lastSeenAt: { lt: cutoff },
    },
    data: { status: 'stale' },
  })
}

let lastStaleSweep = 0
const SWEEP_INTERVAL_MS = 30_000

/**
 * Rate-limited wrapper around markStaleDaemons. Safe to call on hot paths
 * (e.g. every scheduler tick) — will only hit the DB at most once per
 * SWEEP_INTERVAL_MS per process.
 */
export async function sweepStaleDaemonsThrottled(thresholdMs: number = 30_000) {
  const now = Date.now()
  if (now - lastStaleSweep < SWEEP_INTERVAL_MS) return
  lastStaleSweep = now
  try {
    await markStaleDaemons(thresholdMs)
  } catch (err) {
    log.error('sweepStaleDaemons failed', err)
  }
}
