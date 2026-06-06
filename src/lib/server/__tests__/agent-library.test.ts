import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockAgentFindMany = mock(() => Promise.resolve([])) as any
const mockAgentCreateMany = mock(() => Promise.resolve({ count: 0 })) as any
const mockTemplateFindMany = mock(() => Promise.resolve([])) as any
const mockTemplateCreate = mock(() => Promise.resolve({})) as any

mock.module('@/lib/db', () => ({
  db: {
    agent: { findMany: mockAgentFindMany, createMany: mockAgentCreateMany },
    chainTemplate: { findMany: mockTemplateFindMany, create: mockTemplateCreate },
  },
  isPostgresDb: false,
}))

import { getLibrary, getLibrarySummary, importLibrary } from '../agent-library'

beforeEach(() => {
  for (const m of [mockAgentFindMany, mockAgentCreateMany, mockTemplateFindMany, mockTemplateCreate]) m.mockReset()
  mockAgentFindMany.mockResolvedValue([])
  mockAgentCreateMany.mockResolvedValue({ count: 0 })
  mockTemplateFindMany.mockResolvedValue([])
  mockTemplateCreate.mockResolvedValue({})
})

describe('the bundled library artifact', () => {
  test('has the expected shape and scale', () => {
    const library = getLibrary()
    expect(library.agents.length).toBeGreaterThanOrEqual(90)
    expect(library.chains.length).toBeGreaterThanOrEqual(20)
    for (const agent of library.agents) {
      expect(agent.name.length).toBeGreaterThan(2)
      expect(agent.category.length).toBeGreaterThan(2)
      expect(agent.systemPrompt.length).toBeGreaterThan(100)
      expect(agent.role).toBe(agent.name) // chain steps resolve by role
    }
  })

  test('every chain step references a library agent and a valid mode', () => {
    const library = getLibrary()
    const roles = new Set(library.agents.map((a) => a.role))
    const modes = new Set(['analyze', 'verify', 'develop', 'review', 'draft', 'human'])
    for (const chain of library.chains) {
      expect(chain.steps.length).toBeGreaterThanOrEqual(3)
      expect(chain.steps.length).toBeLessThanOrEqual(25) // contract cap
      for (const step of chain.steps) {
        expect(roles.has(step.agentRole)).toBe(true)
        expect(modes.has(step.mode)).toBe(true)
      }
    }
  })

  test('summary groups by category with counts', () => {
    const summary = getLibrarySummary()
    expect(summary.categories.length).toBeGreaterThanOrEqual(10)
    const ddd = summary.categories.find((c) => c.name === 'Domain-Driven Design')
    expect(ddd?.count).toBeGreaterThanOrEqual(30)
    expect(summary.chains[0]).toHaveProperty('stepCount')
  })
})

describe('importLibrary', () => {
  test('imports everything into an empty project', async () => {
    const result = await importLibrary('proj-1', { includeChains: true })
    const library = getLibrary()
    expect(result.agentsCreated).toBe(library.agents.length)
    expect(result.agentsSkipped).toBe(0)
    expect(result.chainsCreated).toBe(library.chains.length)
    const created = mockAgentCreateMany.mock.calls[0][0].data
    expect(created[0]).toMatchObject({ projectId: 'proj-1', isActive: false })
    expect(created[0].category).toBeTruthy()
    expect(created[0].systemPrompt.length).toBeGreaterThan(100)
  })

  test('is idempotent — existing names are skipped', async () => {
    const library = getLibrary()
    mockAgentFindMany.mockResolvedValue(library.agents.map((a) => ({ name: a.name })))
    mockTemplateFindMany.mockResolvedValue(library.chains.map((c) => ({ name: c.name })))

    const result = await importLibrary('proj-1', { includeChains: true })
    expect(result.agentsCreated).toBe(0)
    expect(result.agentsSkipped).toBe(library.agents.length)
    expect(result.chainsCreated).toBe(0)
    expect(result.chainsSkipped).toBe(library.chains.length)
    expect(mockAgentCreateMany).not.toHaveBeenCalled()
    expect(mockTemplateCreate).not.toHaveBeenCalled()
  })

  test('category filter narrows agents and drops unsatisfiable chains', async () => {
    const result = await importLibrary('proj-1', { categories: ['Security'], includeChains: true })
    const library = getLibrary()
    const security = library.agents.filter((a) => a.category === 'Security')
    expect(result.agentsCreated).toBe(security.length)
    // No catalog chain is satisfiable by Security agents alone
    expect(result.chainsCreated + result.chainsSkipped).toBe(library.chains.length)
    const satisfiable = library.chains.filter((c) =>
      c.steps.every((s) => security.some((a) => a.role === s.agentRole)))
    expect(result.chainsCreated).toBe(satisfiable.length)
  })

  test('chains are stored as ChainTemplate-shaped JSON steps', async () => {
    await importLibrary('proj-1', { includeChains: true })
    const data = mockTemplateCreate.mock.calls[0][0].data
    const steps = JSON.parse(data.steps)
    expect(steps[0]).toMatchObject({ autoContinue: true })
    expect(typeof steps[0].agentRole).toBe('string')
    expect(typeof steps[0].mode).toBe('string')
  })
})
