import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createHash } from 'crypto'

// The purge functions take an INJECTABLE db (G-3), so this test passes a fake
// db directly — no `@/lib/db` module-mock. That mock is non-deterministic in
// the full run for a widely-imported module (shared bun mock registry), so
// injection is the reliable seam.
import { migrateLegacyApiKeys, getLegacyApiKeyStatus } from '../legacy-key-purge'

function sha256(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

const projectFindMany = mock(() => Promise.resolve([] as any[])) as any
const agentFindMany = mock(() => Promise.resolve([] as any[])) as any
const projectUpdate = mock((args: any) => Promise.resolve(args)) as any
const agentUpdate = mock((args: any) => Promise.resolve(args)) as any
const projectCount = mock(() => Promise.resolve(0)) as any
const agentCount = mock(() => Promise.resolve(0)) as any
const transaction = mock((ops: any[]) => Promise.all(ops)) as any

// Structural stand-in for the Prisma client — only the slices the purge touches.
const fakeDb = {
  project: { findMany: projectFindMany, update: projectUpdate, count: projectCount },
  agent: { findMany: agentFindMany, update: agentUpdate, count: agentCount },
  $transaction: transaction,
} as any

beforeEach(() => {
  for (const m of [projectFindMany, agentFindMany, projectUpdate, agentUpdate, projectCount, agentCount, transaction]) {
    m.mockReset()
  }
  projectFindMany.mockImplementation(() => Promise.resolve([]))
  agentFindMany.mockImplementation(() => Promise.resolve([]))
  projectUpdate.mockImplementation((args: any) => Promise.resolve(args))
  agentUpdate.mockImplementation((args: any) => Promise.resolve(args))
  projectCount.mockImplementation(() => Promise.resolve(0))
  agentCount.mockImplementation(() => Promise.resolve(0))
  transaction.mockImplementation((ops: any[]) => Promise.all(ops))
})

describe('migrateLegacyApiKeys — legacy plaintext key purge (G-3)', () => {
  test('hashes and NULLs remaining plaintext project + agent keys', async () => {
    const projKey = 'ab_project.p1.plaintext-secret'
    const agentKey = 'ab_agent.a1.plaintext-secret'
    projectFindMany.mockImplementation(() =>
      Promise.resolve([{ id: 'p1', apiKey: projKey, apiKeyPreview: null }]),
    )
    agentFindMany.mockImplementation(() =>
      Promise.resolve([{ id: 'a1', apiKey: agentKey, apiKeyPreview: 'existing-preview' }]),
    )

    const result = await migrateLegacyApiKeys(fakeDb)

    expect(result.totalMigrated).toBe(2)
    expect(result.migratedProjects).toBe(1)
    expect(result.migratedAgents).toBe(1)

    // Project: plaintext NULLed, hash set to sha256(rawKey), preview backfilled.
    const projArg = projectUpdate.mock.calls[0][0]
    expect(projArg.where).toEqual({ id: 'p1' })
    expect(projArg.data.apiKey).toBeNull()
    expect(projArg.data.apiKeyHash).toBe(sha256(projKey))
    // No raw secret survives anywhere in the write.
    expect(JSON.stringify(projArg.data)).not.toContain('plaintext-secret')

    // Agent: same treatment; existing preview preserved.
    const agentArg = agentUpdate.mock.calls[0][0]
    expect(agentArg.where).toEqual({ id: 'a1' })
    expect(agentArg.data.apiKey).toBeNull()
    expect(agentArg.data.apiKeyHash).toBe(sha256(agentKey))
    expect(agentArg.data.apiKeyPreview).toBe('existing-preview')

    // Writes are committed in a single transaction.
    expect(transaction).toHaveBeenCalledTimes(1)
  })

  test('is a no-op when no plaintext keys remain (already-hashed keys untouched)', async () => {
    // findMany filters on apiKey NOT NULL, so hashed-only rows never appear here.
    const result = await migrateLegacyApiKeys(fakeDb)

    expect(result.totalMigrated).toBe(0)
    expect(projectUpdate).not.toHaveBeenCalled()
    expect(agentUpdate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  test('getLegacyApiKeyStatus reports the remaining plaintext counts', async () => {
    projectCount.mockImplementation(() => Promise.resolve(2))
    agentCount.mockImplementation(() => Promise.resolve(3))

    const status = await getLegacyApiKeyStatus(fakeDb)
    expect(status).toEqual({
      projectsWithPlaintext: 2,
      agentsWithPlaintext: 3,
      totalWithPlaintext: 5,
    })
  })
})
