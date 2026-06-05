import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockTemplateFindMany = mock(() => Promise.resolve([])) as any
const mockTemplateFindUnique = mock(() => Promise.resolve(null)) as any
const mockTemplateCreate = mock((args: any) => Promise.resolve({ id: 'tt-1', ...args.data })) as any
const mockTemplateUpdate = mock((args: any) => Promise.resolve({ id: 'tt-1', ...args.data })) as any
const mockTemplateDelete = mock(() => Promise.resolve({})) as any
const mockChainFindUnique = mock(() => Promise.resolve(null)) as any

mock.module('@/lib/db', () => ({
  db: {
    taskTemplate: {
      findMany: mockTemplateFindMany,
      findUnique: mockTemplateFindUnique,
      create: mockTemplateCreate,
      update: mockTemplateUpdate,
      delete: mockTemplateDelete,
    },
    chainTemplate: {
      findUnique: mockChainFindUnique,
    },
  },
  isPostgresDb: false,
}))

beforeEach(() => {
  for (const m of [
    mockTemplateFindMany, mockTemplateFindUnique, mockTemplateCreate,
    mockTemplateUpdate, mockTemplateDelete, mockChainFindUnique,
  ]) m.mockReset()
  mockTemplateFindMany.mockResolvedValue([])
  mockTemplateFindUnique.mockResolvedValue(null)
  mockTemplateCreate.mockImplementation((args: any) => Promise.resolve({ id: 'tt-1', ...args.data }))
  mockTemplateUpdate.mockImplementation((args: any) => Promise.resolve({ id: 'tt-1', ...args.data }))
  mockTemplateDelete.mockResolvedValue({})
  mockChainFindUnique.mockResolvedValue(null)
  setSession(ADMIN_SESSION)
})

const listParams = { params: Promise.resolve({ id: 'p-1' }) }
const itemParams = { params: Promise.resolve({ id: 'p-1', templateId: 'tt-1' }) }

describe('POST /api/projects/[id]/task-templates', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/projects/[id]/task-templates/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/task-templates', { method: 'POST', body: { name: 'Bug' } }),
      listParams,
    )
    expect(res.status).toBe(401)
  })

  test('creates a template scoped to the project', async () => {
    const { POST } = await import('@/app/api/projects/[id]/task-templates/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/task-templates', {
        method: 'POST',
        body: { name: 'Bug report', titlePattern: 'Bug: {date}', priority: 'HIGH', tag: 'backend' },
      }),
      listParams,
    )
    expect(res.status).toBe(200)
    expect(mockTemplateCreate.mock.calls[0][0].data).toMatchObject({
      name: 'Bug report',
      titlePattern: 'Bug: {date}',
      priority: 'HIGH',
      projectId: 'p-1',
    })
  })

  test('rejects an invalid priority', async () => {
    const { POST } = await import('@/app/api/projects/[id]/task-templates/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/task-templates', {
        method: 'POST',
        body: { name: 'Bad', priority: 'WHENEVER' },
      }),
      listParams,
    )
    expect(res.status).toBe(400)
    expect(mockTemplateCreate).not.toHaveBeenCalled()
  })

  test('rejects a chainTemplateId from another project', async () => {
    mockChainFindUnique.mockResolvedValue({ projectId: 'other-project' })
    const { POST } = await import('@/app/api/projects/[id]/task-templates/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/task-templates', {
        method: 'POST',
        body: { name: 'With chain', chainTemplateId: 'ct-other' },
      }),
      listParams,
    )
    expect(res.status).toBe(400)
    expect(mockTemplateCreate).not.toHaveBeenCalled()
  })

  test('accepts a chainTemplateId from this project', async () => {
    mockChainFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { POST } = await import('@/app/api/projects/[id]/task-templates/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/p-1/task-templates', {
        method: 'POST',
        body: { name: 'With chain', chainTemplateId: 'ct-1' },
      }),
      listParams,
    )
    expect(res.status).toBe(200)
    expect(mockTemplateCreate.mock.calls[0][0].data.chainTemplateId).toBe('ct-1')
  })
})

describe('PUT /api/projects/[id]/task-templates/[templateId]', () => {
  test('404 when the template belongs to another project', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'other-project' })
    const { PUT } = await import('@/app/api/projects/[id]/task-templates/[templateId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/task-templates/tt-1', {
        method: 'PUT',
        body: { name: 'Renamed' },
      }),
      itemParams,
    )
    expect(res.status).toBe(404)
    expect(mockTemplateUpdate).not.toHaveBeenCalled()
  })

  test('updates fields and can clear them with null', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { PUT } = await import('@/app/api/projects/[id]/task-templates/[templateId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/task-templates/tt-1', {
        method: 'PUT',
        body: { name: 'Renamed', chainTemplateId: null, priority: null },
      }),
      itemParams,
    )
    expect(res.status).toBe(200)
    expect(mockTemplateUpdate.mock.calls[0][0].data).toMatchObject({
      name: 'Renamed',
      chainTemplateId: null,
      priority: null,
    })
  })

  test('rejects an empty payload', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { PUT } = await import('@/app/api/projects/[id]/task-templates/[templateId]/route')
    const res = await PUT(
      makeRequest('http://localhost/api/projects/p-1/task-templates/tt-1', { method: 'PUT', body: {} }),
      itemParams,
    )
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/projects/[id]/task-templates/[templateId]', () => {
  test('deletes a template in this project', async () => {
    mockTemplateFindUnique.mockResolvedValue({ projectId: 'p-1' })
    const { DELETE } = await import('@/app/api/projects/[id]/task-templates/[templateId]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/p-1/task-templates/tt-1', { method: 'DELETE' }),
      itemParams,
    )
    expect(res.status).toBe(200)
    expect(mockTemplateDelete).toHaveBeenCalled()
  })

  test('404 for an unknown template', async () => {
    const { DELETE } = await import('@/app/api/projects/[id]/task-templates/[templateId]/route')
    const res = await DELETE(
      makeRequest('http://localhost/api/projects/p-1/task-templates/tt-1', { method: 'DELETE' }),
      itemParams,
    )
    expect(res.status).toBe(404)
    expect(mockTemplateDelete).not.toHaveBeenCalled()
  })
})
