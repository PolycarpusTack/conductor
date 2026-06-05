import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'
import { safeJsonParse } from '@/lib/server/utils'

const log = getLogger('host-presence')

/**
 * Host status thresholds. Daemons heartbeat every ~30s and flip to `stale`
 * after one missed beat (see markStaleDaemons in daemon-auth.ts); hosts are
 * deliberately more lenient — a machine is "online" if any daemon on it was
 * heard from in the last 2 minutes, "stale" up to 10, "offline" beyond that.
 */
export const HOST_ONLINE_THRESHOLD_MS = 120_000
export const HOST_STALE_THRESHOLD_MS = 600_000

export type HostStatus = 'online' | 'stale' | 'offline'

export function deriveHostStatus(lastSeenAt: Date | null | undefined): HostStatus {
  if (!lastSeenAt) return 'offline'
  const age = Date.now() - lastSeenAt.getTime()
  if (age < HOST_ONLINE_THRESHOLD_MS) return 'online'
  if (age < HOST_STALE_THRESHOLD_MS) return 'stale'
  return 'offline'
}

function normalizeHostnameSlug(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface UpsertHostInput {
  workspaceId: string
  /** Daemon-persisted installation ID — stable across hostname changes. */
  installationId?: string | null
  hostname: string
  displayName?: string | null
  platform: string
  arch?: string | null
  labels?: string[] | null
  trustLevel?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Creates or refreshes the Host a daemon runs on, keyed by
 * (workspaceId, slug). Returns the host id for linking onto the daemon.
 */
export async function upsertHostForDaemon(input: UpsertHostInput): Promise<string> {
  const slug = input.installationId?.trim() || normalizeHostnameSlug(input.hostname)
  const now = new Date()

  const shared = {
    displayName: input.displayName?.trim() || input.hostname,
    hostname: input.hostname,
    platform: input.platform,
    arch: input.arch ?? null,
    labels: input.labels ? JSON.stringify(input.labels) : null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    status: 'online' as const,
    lastSeenAt: now,
  }

  const host = await db.host.upsert({
    where: { workspaceId_slug: { workspaceId: input.workspaceId, slug } },
    create: {
      workspaceId: input.workspaceId,
      slug,
      trustLevel: input.trustLevel ?? 'local',
      ...shared,
    },
    update: {
      // trustLevel is admin-managed after creation — never downgraded by re-register
      ...shared,
    },
  })

  return host.id
}

export interface HeartbeatMetrics {
  activeSessions?: number
  inFlightSteps?: number
  cpuPct?: number
  memoryMb?: number
}

/**
 * Refreshes a host's presence on daemon heartbeat. Merges the latest
 * metrics into metadata. Never throws — presence must not break heartbeat.
 */
export async function touchHost(hostId: string | null | undefined, metrics?: HeartbeatMetrics): Promise<void> {
  if (!hostId) return

  try {
    let metadata: string | undefined
    if (metrics) {
      const existing = await db.host.findUnique({ where: { id: hostId }, select: { metadata: true } })
      const parsed = safeJsonParse<Record<string, unknown>>(existing?.metadata ?? null, {})
      metadata = JSON.stringify({ ...parsed, metrics, metricsAt: new Date().toISOString() })
    }

    await db.host.update({
      where: { id: hostId },
      data: {
        lastSeenAt: new Date(),
        status: 'online',
        ...(metadata !== undefined ? { metadata } : {}),
      },
    })
  } catch (err) {
    log.warn('failed to touch host', { hostId, err: String(err) })
  }
}
