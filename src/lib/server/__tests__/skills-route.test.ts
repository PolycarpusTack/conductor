import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// G3-1-T2 — GET /api/skills?projectId=…: the agent editor asks by project;
// the route resolves the project's workspace server-side (skills are
// workspace-scoped) and tells the UI when there is no workspace to attach from.
// ---------------------------------------------------------------------------

import { dbMock } from './db-mock'

const mockProjectFindUnique = mock(() => Promise.resolve(null as unknown)) as any
const mockSkillFindMany = mock(() => Promise.resolve([] as unknown[])) as any

mock.module('@/lib/db', () => ({
  db: dbMock({
    project: { findUnique: mockProjectFindUnique },
    skill: { findMany: mockSkillFindMany },
  }),
  isPostgresDb: false,
}))

mock.module('@/lib/server/admin-session', () => ({
  requireAdminSession: () => Promise.resolve(null),
  requireRole: () => Promise.resolve(null),
}))

import { GET } from '@/app/api/skills/route'

beforeEach(() => {
  mockProjectFindUnique.mockReset()
  mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws-1' })
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
