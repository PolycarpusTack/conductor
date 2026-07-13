import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---------------------------------------------------------------------------
// ADR-0010 — validateSkillAttach: skills are workspace-scoped; an attach is
// legal only when every skill lives in the agent's project's workspace.
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

import { validateSkillAttach } from '../skill-attach'

beforeEach(() => {
  mockProjectFindUnique.mockReset()
  mockProjectFindUnique.mockResolvedValue({ workspaceId: 'ws-1' })
  mockSkillFindMany.mockReset()
  mockSkillFindMany.mockResolvedValue([{ id: 'skill-1' }])
})

describe('validateSkillAttach', () => {
  test('empty attach is always legal (and hits no db)', async () => {
    expect(await validateSkillAttach([], 'p-1')).toBeNull()
    expect(mockProjectFindUnique).not.toHaveBeenCalled()
  })

  test('legal attach: every skill in the project workspace → null', async () => {
    expect(await validateSkillAttach(['skill-1'], 'p-1')).toBeNull()
    // The lookup itself must be workspace-scoped.
    expect(mockSkillFindMany.mock.calls[0][0].where).toEqual({
      id: { in: ['skill-1'] },
      workspaceId: 'ws-1',
    })
  })

  test('workspace-less project → clear error, skills never looked up', async () => {
    mockProjectFindUnique.mockResolvedValue({ workspaceId: null })
    const error = await validateSkillAttach(['skill-1'], 'p-1')
    expect(error).toContain('workspace')
    expect(mockSkillFindMany).not.toHaveBeenCalled()
  })

  test('cross-workspace / unknown skill ids are named in the error', async () => {
    mockSkillFindMany.mockResolvedValue([{ id: 'skill-1' }])
    const error = await validateSkillAttach(['skill-1', 'skill-foreign'], 'p-1')
    expect(error).toContain('skill-foreign')
    expect(error).not.toContain('skill-1,')
  })

  test('unknown project → error', async () => {
    mockProjectFindUnique.mockResolvedValue(null)
    expect(await validateSkillAttach(['skill-1'], 'p-ghost')).toContain('Project not found')
  })
})
