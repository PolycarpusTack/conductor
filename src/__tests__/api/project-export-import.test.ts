import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { setSession, ADMIN_SESSION, makeRequest } from '../helpers/auth'

// A project shaped exactly as buildProjectExport's `select` returns it.
const exportProject = {
  name: 'Proj',
  description: null,
  color: '#3b82f6',
  automationMode: 'manual',
  automationSchedule: null,
  automationPollMs: 10000,
  logRetentionDays: null,
  defaultStepMode: null,
  defaultChainTemplateId: null,
  autoArchiveDays: null,
  reviewEscalationHours: null,
  artifactRetentionDays: null,
  budgetUsd: null,
  agents: [{ id: 'a1', name: 'Builder', apiKey: 'sk-LEAK', apiKeyHash: 'H', role: 'dev' }],
  modes: [{ name: 'develop', label: 'Develop' }],
  runtimes: [{ id: 'rt1', adapter: 'anthropic', name: 'Claude', models: '[]', apiKeyEnvVar: 'ANTHROPIC_API_KEY' }],
  chainTemplates: [],
  tasks: [{ id: 't1', title: 'T', status: 'BACKLOG', priority: 'MEDIUM', order: 0, agentId: 'a1', steps: [] }],
}

const mockFindUnique = mock(() => Promise.resolve(exportProject)) as any

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
mock.module('@/lib/db', () => ({
  db: {
    project: {
      findUnique: (args: any) =>
        // buildProjectExport passes { where: { id }, select }; workspace helper
        // passes { where: { slug }, select } — only the former is under test.
        args?.where?.slug ? Promise.resolve(null) : mockFindUnique(),
      create: () => Promise.resolve({ id: 'proj-new' }),
      update: () => Promise.resolve({ id: 'proj-new' }),
    },
    projectRuntime: { create: () => Promise.resolve({ id: 'rt-new' }) },
    agent: { create: () => Promise.resolve({ id: 'ag-new' }) },
    projectMode: { create: () => Promise.resolve({ id: 'm-new' }) },
    chainTemplate: { create: () => Promise.resolve({ id: 'ct-new' }) },
    task: { create: () => Promise.resolve({ id: 'task-new' }) },
    taskStep: { create: () => Promise.resolve({ id: 'step-new' }) },
    workspace: {
      findUnique: () => Promise.resolve({ id: 'ws-1' }),
      create: () => Promise.resolve({ id: 'ws-1' }),
    },
  },
  isPostgresDb: false,
}))

const params = { params: Promise.resolve({ id: 'proj-1' }) }
const noParams = { params: Promise.resolve({}) }

const validBundle = {
  version: 1,
  project: { name: 'Imported Me' },
  agents: [], modes: [], runtimes: [], chainTemplates: [], tasks: [],
}

beforeEach(() => {
  mockFindUnique.mockReset()
  mockFindUnique.mockResolvedValue(exportProject)
})

describe('GET /api/projects/[id]/export', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { GET } = await import('@/app/api/projects/[id]/export/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/export'), params)
    expect(res.status).toBe(401)
  })

  test('200 with a secret-free bundle when authenticated', async () => {
    setSession(ADMIN_SESSION)
    const { GET } = await import('@/app/api/projects/[id]/export/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/export'), params)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('apiKey')
    expect(text).not.toContain('sk-LEAK')
    const body = JSON.parse(text)
    expect(body.version).toBe(1)
    expect(body.agents[0].name).toBe('Builder')
  })

  test('404 when the project does not exist', async () => {
    setSession(ADMIN_SESSION)
    mockFindUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/projects/[id]/export/route')
    const res = await GET(makeRequest('http://localhost/api/projects/proj-1/export'), params)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/projects/import', () => {
  test('401 when unauthenticated', async () => {
    setSession(null)
    const { POST } = await import('@/app/api/projects/import/route')
    const res = await POST(makeRequest('http://localhost/api/projects/import', { method: 'POST', body: { bundle: validBundle } }), noParams)
    expect(res.status).toBe(401)
  })

  test('403 for a cross-origin request', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/projects/import/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/import', {
        method: 'POST',
        body: { bundle: validBundle },
        headers: { origin: 'https://evil.com' },
      }),
      noParams,
    )
    expect(res.status).toBe(403)
  })

  test('400 for a malformed bundle', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/projects/import/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/import', { method: 'POST', body: { bundle: { nope: true } } }), noParams,
    )
    expect(res.status).toBe(400)
  })

  test('201 and creates a new project on a valid bundle', async () => {
    setSession(ADMIN_SESSION)
    const { POST } = await import('@/app/api/projects/import/route')
    const res = await POST(
      makeRequest('http://localhost/api/projects/import', { method: 'POST', body: { bundle: validBundle } }),
      noParams,
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.name).toBe('Imported Me (imported)')
    expect(body.projectId).toBeTruthy()
  })
})
