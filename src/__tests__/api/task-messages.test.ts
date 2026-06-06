import { describe, test, expect, mock } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

const NOW = new Date()

const mockMessage = {
  id: 'msg-1',
  projectId: 'p-1',
  taskId: 't-1',
  stepId: null,
  threadId: 'msg-1',
  fromAgentId: 'agent-1',
  toAgentId: 'agent-2',
  fromAddress: 'researcher',
  toAddress: 'reviewer',
  priority: 'normal',
  subject: null,
  body: 'hello',
  bodySecurity: '{"trust":"agent","flags":[]}',
  status: 'queued',
  readAt: null,
  createdAt: NOW,
  deliveredAt: null,
}

const mockMessageCreate = mock(() =>
  Promise.resolve({ ...mockMessage, id: 'msg-new', threadId: null, fromAddress: 'admin@conductor' }),
) as any
const mockMessageUpdate = mock(() => Promise.resolve({})) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    task: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 't-1' ? { id: 't-1', projectId: 'p-1' } : null),
    },
    agentMessage: {
      findMany: () => Promise.resolve([mockMessage]),
      create: mockMessageCreate,
      update: mockMessageUpdate,
    },
    agentAddress: {
      findUnique: ({ where }: { where: { projectId_address: { address: string } } }) =>
        Promise.resolve(
          where.projectId_address.address === 'reviewer' ? { agentId: 'agent-2', active: true } : null,
        ),
      upsert: () => Promise.resolve({}),
    },
  },
  isPostgresDb: false,
}))

const taskParams = { params: Promise.resolve({ id: 't-1' }) }

describe('GET /api/tasks/[id]/messages — auth', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/tasks/[id]/messages/route')
    const res = await GET(makeRequest('http://localhost/api/tasks/t-1/messages'), taskParams)
    expect(res.status).toBe(401)
  })

  test('returns the thread with parsed security metadata when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/tasks/[id]/messages/route')
    const res = await GET(makeRequest('http://localhost/api/tasks/t-1/messages'), taskParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].bodySecurity.trust).toBe('agent')
  })
})

describe('POST /api/tasks/[id]/messages — auth', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/tasks/[id]/messages/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/messages', {
        method: 'POST',
        body: { to: 'reviewer', body: 'hi' },
      }),
      taskParams,
    )
    expect(res.status).toBe(401)
  })

  test('403 for cross-origin request when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/tasks/[id]/messages/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/messages', {
        method: 'POST',
        body: { to: 'reviewer', body: 'hi' },
        headers: { origin: 'https://evil.com' },
      }),
      taskParams,
    )
    expect(res.status).toBe(403)
  })

  test('201 sends signed with the session user and admin trust', async () => {
    setSession(ADMIN_SESSION)
    mockMessageCreate.mockClear()
    const { POST } = await import('@/app/api/tasks/[id]/messages/route')
    const res = await POST(
      makeRequest('http://localhost/api/tasks/t-1/messages', {
        method: 'POST',
        body: { to: 'reviewer', body: 'Please prioritize this.' },
      }),
      taskParams,
    )
    expect(res.status).toBe(201)
    const create = mockMessageCreate.mock.calls[0][0]
    // Attribution (Phase 2): messages are signed with the session user's
    // local-part; the fixture user is user-1@test.local.
    expect(create.data.fromAddress).toBe('user-1@conductor')
    expect(create.data.taskId).toBe('t-1')
    expect(JSON.parse(create.data.bodySecurity).trust).toBe('admin')
  })
})

describe('GET /api/projects/[id]/messages — auth', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/messages/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/messages'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(401)
  })

  test('returns project messages when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/projects/[id]/messages/route')
    const res = await GET(makeRequest('http://localhost/api/projects/p-1/messages'), {
      params: Promise.resolve({ id: 'p-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(1)
  })
})
