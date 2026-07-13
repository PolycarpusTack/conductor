import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// G3-1-T2 — GET /api/skills?projectId=…: the agent editor asks by project;
// the route resolves the project's workspace server-side (skills are
// workspace-scoped) and tells the UI when there is no workspace to attach from.
// ---------------------------------------------------------------------------

import { dbMock } from './db-mock'

const mockProjectFindUnique = mock(() => Promise.resolve(null as unknown)) as any
const mockSkillFindMany = mock(() => Promise.resolve([] as unknown[])) as any
const mockSkillCreate = mock((args: any) => Promise.resolve({ id: 'skill-new', ...args.data })) as any
const mockGenerateEmbedding = mock(() => Promise.resolve([0.1, 0.2, 0.3])) as any

mock.module('@/lib/db', () => ({
  db: dbMock({
    project: { findUnique: mockProjectFindUnique },
    skill: { findMany: mockSkillFindMany, create: mockSkillCreate },
  }),
  isPostgresDb: false,
}))

mock.module('@/lib/server/admin-session', () => ({
  requireAdminSession: () => Promise.resolve(null),
  requireRole: () => Promise.resolve(null),
}))

// Full export surface (shared mock.module registry rule).
mock.module('@/lib/server/embeddings', () => ({
  generateEmbedding: mockGenerateEmbedding,
}))

// requireWorkspaceId resolves/validates the target workspace for POST.
// Full export surface (shared mock.module registry rule).
mock.module('@/lib/server/workspace', () => ({
  requireWorkspaceId: mock(() => Promise.resolve('ws-1')) as any,
  ensureDefaultWorkspace: () => Promise.resolve('ws-1'),
  backfillProjectWorkspaces: () => Promise.resolve(0),
  getWorkspaces: () => Promise.resolve([]),
  getWorkspaceBySlug: () => Promise.resolve(null),
}))

import { GET, POST } from '@/app/api/skills/route'

beforeEach(() => {
  mockProjectFindUnique.mockReset()
  mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws-1' })
  mockSkillCreate.mockReset()
  mockSkillCreate.mockImplementation((args: any) => Promise.resolve({ id: 'skill-new', ...args.data }))
  mockGenerateEmbedding.mockReset()
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
  mockSkillFindMany.mockReset()
  mockSkillFindMany.mockResolvedValue([
    {
      id: 'skill-1',
      title: 'Code Review Checklist',
      description: null,
      tags: null,
      sourceTaskId: null,
      version: 1,
      workspaceId: 'ws-1',
      createdAt: new Date('2026-07-01'),
      updatedAt: new Date('2026-07-01'),
    },
  ])
})

const params = { params: Promise.resolve({}) }

describe('GET /api/skills?projectId', () => {
  test('resolves the project workspace and scopes the list to it', async () => {
    const res = await GET(new Request('http://localhost/api/skills?projectId=p-1'), params)
    const body = await res.json()
    expect(body.workspaceId).toBe('ws-1')
    expect(body.data).toHaveLength(1)
    expect(mockSkillFindMany.mock.calls[0][0].where).toEqual({ workspaceId: 'ws-1' })
  })

  test('workspace-less project → empty list + workspaceId null (UI shows why)', async () => {
    mockProjectFindUnique.mockResolvedValue({ workspaceId: null })
    const res = await GET(new Request('http://localhost/api/skills?projectId=p-1'), params)
    const body = await res.json()
    expect(body).toEqual({ data: [], total: 0, workspaceId: null })
    expect(mockSkillFindMany).not.toHaveBeenCalled()
  })
})

function makePost(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// G3-2-T1 (gap 1.14): skills embed ON SAVE — before this, the pgvector search
// path (`WHERE embedding IS NOT NULL`) had zero rows to search, forever.
describe('POST /api/skills — embed on save', () => {
  test('persists the embedding as a JSON float-array string', async () => {
    const res = await POST(
      makePost({ title: 'Review checklist', description: 'PRs', body: 'Check error paths.' }),
      params,
    )
    expect(res.status).toBe(200)
    // Embeds title + description + body (what the search box queries against).
    expect(mockGenerateEmbedding.mock.calls[0][0]).toBe('Review checklist\nPRs\nCheck error paths.')
    expect(mockSkillCreate.mock.calls[0][0].data.embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]))
  })

  test('embedding unavailable → skill still saves with embedding null (text search covers)', async () => {
    mockGenerateEmbedding.mockResolvedValue(null)
    const res = await POST(makePost({ title: 'T', body: 'B' }), params)
    expect(res.status).toBe(200)
    expect(mockSkillCreate.mock.calls[0][0].data.embedding).toBeNull()
  })
})
