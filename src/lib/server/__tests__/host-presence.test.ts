import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// this factory must expose the full export surface of the real module.
const mockHostUpsert = mock(() => Promise.resolve({ id: 'host-1' })) as any
const mockHostUpdate = mock(() => Promise.resolve({})) as any
const mockHostFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    host: {
      upsert: mockHostUpsert,
      update: mockHostUpdate,
      findUnique: mockHostFindUnique,
    },
  },
  isPostgresDb: false,
}))

import {
  upsertHostForDaemon,
  touchHost,
  deriveHostStatus,
  HOST_ONLINE_THRESHOLD_MS,
  HOST_STALE_THRESHOLD_MS,
} from '../host-presence'

beforeEach(() => {
  mockHostUpsert.mockReset()
  mockHostUpsert.mockImplementation(() => Promise.resolve({ id: 'host-1' }))
  mockHostUpdate.mockReset()
  mockHostUpdate.mockImplementation(() => Promise.resolve({}))
  mockHostFindUnique.mockReset()
  mockHostFindUnique.mockImplementation(() =>
    Promise.resolve({ id: 'host-1', metadata: JSON.stringify({ arch: 'x64' }) }),
  )
})

describe('upsertHostForDaemon', () => {
  test('upserts keyed by (workspaceId, slug) using the installation id', async () => {
    const hostId = await upsertHostForDaemon({
      workspaceId: 'ws-1',
      installationId: 'inst-abc',
      hostname: 'devbox',
      platform: 'linux',
      arch: 'x64',
    })
    expect(hostId).toBe('host-1')
    expect(mockHostUpsert).toHaveBeenCalledTimes(1)
    const call = mockHostUpsert.mock.calls[0][0]
    expect(call.where.workspaceId_slug).toEqual({ workspaceId: 'ws-1', slug: 'inst-abc' })
    expect(call.create.hostname).toBe('devbox')
    expect(call.create.status).toBe('online')
    expect(call.update.hostname).toBe('devbox')
    expect(call.update.lastSeenAt).toBeInstanceOf(Date)
  })

  test('falls back to a normalized hostname slug when no installation id', async () => {
    await upsertHostForDaemon({
      workspaceId: 'ws-1',
      hostname: 'My MacBook.Local',
      platform: 'darwin',
    })
    const call = mockHostUpsert.mock.calls[0][0]
    expect(call.where.workspaceId_slug.slug).toBe('my-macbook-local')
  })

  test('defaults displayName to hostname', async () => {
    await upsertHostForDaemon({ workspaceId: 'ws-1', hostname: 'devbox', platform: 'linux' })
    const call = mockHostUpsert.mock.calls[0][0]
    expect(call.create.displayName).toBe('devbox')
  })
})

describe('touchHost', () => {
  test('updates lastSeenAt, sets status online, and merges metrics into metadata', async () => {
    await touchHost('host-1', { cpuPct: 12, memoryMb: 2048 })
    expect(mockHostUpdate).toHaveBeenCalledTimes(1)
    const call = mockHostUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'host-1' })
    expect(call.data.status).toBe('online')
    expect(call.data.lastSeenAt).toBeInstanceOf(Date)
    const metadata = JSON.parse(call.data.metadata)
    expect(metadata.arch).toBe('x64') // existing metadata preserved
    expect(metadata.metrics.cpuPct).toBe(12)
  })

  test('is a no-op for null hostId', async () => {
    await touchHost(null)
    expect(mockHostUpdate).not.toHaveBeenCalled()
  })

  test('swallows update failures (presence must not break heartbeat)', async () => {
    mockHostUpdate.mockRejectedValueOnce(new Error('db down'))
    await expect(touchHost('host-1')).resolves.toBeUndefined()
  })
})

describe('deriveHostStatus', () => {
  test('returns offline for null lastSeenAt', () => {
    expect(deriveHostStatus(null)).toBe('offline')
  })

  test('returns online within the online threshold', () => {
    expect(deriveHostStatus(new Date(Date.now() - HOST_ONLINE_THRESHOLD_MS + 5_000))).toBe('online')
  })

  test('returns stale between thresholds', () => {
    expect(deriveHostStatus(new Date(Date.now() - HOST_ONLINE_THRESHOLD_MS - 5_000))).toBe('stale')
  })

  test('returns offline past the stale threshold', () => {
    expect(deriveHostStatus(new Date(Date.now() - HOST_STALE_THRESHOLD_MS - 5_000))).toBe('offline')
  })
})
