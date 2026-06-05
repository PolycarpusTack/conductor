import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    taskStep: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'step-1' ? { taskId: 't-1' } : null),
    },
    stepExecution: { findMany: () => Promise.resolve([]) },
    stepArtifact: { findMany: () => Promise.resolve([]) },
    stepEvent: { findMany: () => Promise.resolve([]) },
    agentSession: { findMany: () => Promise.resolve([]) },
    agentMessage: { findMany: () => Promise.resolve([]) },
  },
  isPostgresDb: false,
}))

const stepParams = { params: Promise.resolve({ id: 't-1', stepId: 'step-1' }) }

describe('GET /api/tasks/[id]/steps/[stepId]/evidence — auth', () => {
  test('returns 401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/tasks/[id]/steps/[stepId]/evidence/route')
    const res = await GET(makeRequest('http://localhost/api/tasks/t-1/steps/step-1/evidence'), stepParams)
    expect(res.status).toBe(401)
  })

  test('returns the packet when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/tasks/[id]/steps/[stepId]/evidence/route')
    const res = await GET(makeRequest('http://localhost/api/tasks/t-1/steps/step-1/evidence'), stepParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stepId).toBe('step-1')
    expect(body.executions).toEqual([])
  })

  test('returns 404 for a step outside the task', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/tasks/[id]/steps/[stepId]/evidence/route')
    const res = await GET(makeRequest('http://localhost/api/tasks/t-1/steps/nope/evidence'), {
      params: Promise.resolve({ id: 't-1', stepId: 'nope' }),
    })
    expect(res.status).toBe(404)
  })
})
