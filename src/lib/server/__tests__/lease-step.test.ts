import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Mock heavy dependencies before importing the module under test
// ---------------------------------------------------------------------------

const mockTaskStepFindUnique = mock(() => Promise.resolve(null)) as any
const mockTaskStepUpdateMany = mock(() => Promise.resolve({ count: 1 })) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findUnique: mockTaskStepFindUnique,
      updateMany: mockTaskStepUpdateMany,
    },
  },
}))

// leaseStep doesn't broadcast, but dispatch.ts imports realtime at the top;
// mock it so we don't pull in the full socket stack during tests.
mock.module('@/lib/server/realtime', () => ({
  broadcastProjectEvent: mock(() => Promise.resolve()) as any,
}))

// Import AFTER all mocks are in place
import { leaseStep } from '../dispatch'

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTaskStepFindUnique.mockReset()
  mockTaskStepUpdateMany.mockReset()
  mockTaskStepFindUnique.mockResolvedValue(null)
  mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })
})

// ===========================================================================
// leaseStep
// ===========================================================================

describe('leaseStep', () => {
  test('steals an expired lease and reports the evicted holder', async () => {
    // Previous holder was another worker — reclamation should record who we
    // evicted so the activity log can capture it.
    mockTaskStepFindUnique.mockResolvedValue({ leasedBy: 'worker-dead' })
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    const result = await leaseStep('step-1')

    expect(result).toEqual({ taken: true, evictedFrom: 'worker-dead' })

    // The updateMany `where` must include the expired-lease OR-branch,
    // otherwise expired leases could never be reclaimed.
    const updateArgs = mockTaskStepUpdateMany.mock.calls[0][0]
    const orBranches = updateArgs.where.OR as Array<Record<string, unknown>>
    const hasExpiredBranch = orBranches.some(
      (branch) =>
        branch.leasedAt !== undefined &&
        typeof branch.leasedAt === 'object' &&
        branch.leasedAt !== null &&
        'lt' in (branch.leasedAt as Record<string, unknown>),
    )
    expect(hasExpiredBranch).toBe(true)
  })

  test('returns taken=false when the lease is contended (updateMany count=0)', async () => {
    // A concurrent dispatcher beat us — updateMany's `where` didn't match any
    // row because another worker just took ownership. No eviction should be
    // reported even though prior read showed an old holder.
    mockTaskStepFindUnique.mockResolvedValue({ leasedBy: 'worker-other' })
    mockTaskStepUpdateMany.mockResolvedValue({ count: 0 })

    const result = await leaseStep('step-1')

    expect(result).toEqual({ taken: false, evictedFrom: null })
  })

  test('acquires an unleased step without reporting eviction', async () => {
    // First-time claim on a step that nobody held — taken:true but
    // evictedFrom must be null so we don't write a spurious "reclaimed" log.
    mockTaskStepFindUnique.mockResolvedValue({ leasedBy: null })
    mockTaskStepUpdateMany.mockResolvedValue({ count: 1 })

    const result = await leaseStep('step-1')

    expect(result).toEqual({ taken: true, evictedFrom: null })
  })
})
