import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// Test target: PUT src/app/api/tasks/[id]/steps/[stepId]/route.ts (review path)
// + src/lib/server/review-logic.ts (real).
//
// SECURITY (G-3): the reviewer credited with a sign-off MUST be the
// authenticated session identity, never the body-supplied `reviewer` string.
// Otherwise one person could satisfy an N-approver gate by POSTing N names.
// ---------------------------------------------------------------------------

// helpers/auth registers the canonical @/lib/server/admin-session mock and
// exposes setSession. getSessionUser() returns { id, email: `${id}@test.local` }.
import { setSession } from '../../../__tests__/helpers/auth'

const STEP_ID = 'step-1'
const TASK_ID = 'task-1'
const PROJECT_ID = 'proj-1'

type ReviewRow = { reviewer: string; decision: string }
const state = {
  requiredSignOffs: 2,
  reviews: [] as ReviewRow[],
}

const stepFindUnique = mock(() =>
  Promise.resolve({
    id: STEP_ID,
    taskId: TASK_ID,
    status: 'active',
    requiredSignOffs: state.requiredSignOffs,
    task: { projectId: PROJECT_ID },
    reviews: state.reviews.slice(),
  }),
) as any

let reviewSeq = 0
const stepReviewCreate = mock((args: { data: { reviewer: string; decision: string; note: string | null } }) => {
  state.reviews.push({ reviewer: args.data.reviewer, decision: args.data.decision })
  return Promise.resolve({ id: `rev-${++reviewSeq}`, ...args.data, supersededAt: null, createdAt: new Date() })
}) as any

const stepUpdate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    taskStep: { findUnique: stepFindUnique, update: stepUpdate },
    stepReview: { create: stepReviewCreate },
  },
}))

const advanceChain = mock(() => Promise.resolve()) as any
const rewindChain = mock(() => Promise.resolve()) as any
const findPreviousAgentStep = mock(() => Promise.resolve(null)) as any
mock.module('@/lib/server/dispatch', () => ({
  advanceChain,
  rewindChain,
  findPreviousAgentStep,
  dispatchStep: mock(() => Promise.resolve()) as any,
  closeChain: mock(() => Promise.resolve()) as any,
}))

mock.module('@/lib/server/project-event', () => ({
  fireProjectEvent: mock(() => Promise.resolve()) as any,
}))

// Import AFTER mocks are registered.
import { PUT } from '@/app/api/tasks/[id]/steps/[stepId]/route'

function reviewRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/tasks/${TASK_ID}/steps/${STEP_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' },
    body: JSON.stringify(body),
  })
}

function ctx() {
  return { params: Promise.resolve({ id: TASK_ID, stepId: STEP_ID }) }
}

async function approve(spoofName: string) {
  const res = await PUT(reviewRequest({ action: 'review', decision: 'approved', reviewer: spoofName }), ctx())
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

beforeEach(() => {
  state.requiredSignOffs = 2
  state.reviews = []
  reviewSeq = 0
  advanceChain.mockClear()
  stepReviewCreate.mockClear()
  stepUpdate.mockClear()
})

describe('reviewer-identity binding (G-3)', () => {
  test('credits the AUTHENTICATED session identity, ignoring the body reviewer', async () => {
    setSession({ id: 'user-A', role: 'admin' })
    const { status } = await approve('attacker-supplied-user-B')

    expect(status).toBe(200)
    expect(stepReviewCreate).toHaveBeenCalledTimes(1)
    // The persisted reviewer is the session email, NOT the spoofed body value.
    expect(stepReviewCreate.mock.calls[0][0].data.reviewer).toBe('user-A@test.local')
    expect(state.reviews[0].reviewer).toBe('user-A@test.local')
  })

  test('two approvals from the SAME authenticated user do NOT satisfy a 2-sign-off gate', async () => {
    setSession({ id: 'user-A', role: 'admin' })
    const first = await approve('claims-to-be-user-B')
    expect(first.status).toBe(200)
    expect(first.body.action).toBe('approved_awaiting_signoffs')
    expect(first.body.approvalCount).toBe(1)

    // Same authenticated user tries again under a different invented name.
    setSession({ id: 'user-A', role: 'admin' })
    const second = await approve('claims-to-be-user-C')

    // Duplicate approval from the same identity is rejected — the gate is NOT met.
    expect(second.status).not.toBe(200)
    expect(advanceChain).not.toHaveBeenCalled()
    // Only the first approval was ever recorded.
    expect(state.reviews).toHaveLength(1)
  })

  test('approvals from TWO different authenticated users DO satisfy the gate', async () => {
    setSession({ id: 'user-A', role: 'admin' })
    const first = await approve('spoof-1')
    expect(first.body.approvalCount).toBe(1)
    expect(advanceChain).not.toHaveBeenCalled()

    setSession({ id: 'user-B', role: 'admin' })
    const second = await approve('spoof-2')

    expect(second.status).toBe(200)
    expect(second.body.action).toBe('approved_and_advanced')
    expect(second.body.approvalCount).toBe(2)
    expect(advanceChain).toHaveBeenCalledTimes(1)
    expect(state.reviews.map((r) => r.reviewer).sort()).toEqual(['user-A@test.local', 'user-B@test.local'])
  })
})
