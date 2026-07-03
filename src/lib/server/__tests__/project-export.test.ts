import { describe, test, expect, mock, beforeEach } from 'bun:test'

// NOTE: bun's mock.module registry is shared across test files in a run, so
// each factory must expose the full export surface of the real module.
const mockProjectCreate = mock((args: any) => Promise.resolve({ id: 'proj-new', ...args.data })) as any
const mockProjectUpdate = mock((args: any) => Promise.resolve({ id: args.where.id })) as any
const mockRuntimeCreate = mock(() => Promise.resolve({ id: 'rt-new' })) as any
const mockAgentCreate = mock(() => Promise.resolve({ id: 'ag-new' })) as any
const mockModeCreate = mock(() => Promise.resolve({ id: 'mode-new' })) as any
const mockChainTemplateCreate = mock(() => Promise.resolve({ id: 'ct-new' })) as any
const mockTaskCreate = mock(() => Promise.resolve({ id: 'task-new' })) as any
const mockTaskStepCreate = mock(() => Promise.resolve({ id: 'step-new' })) as any

mock.module('@/lib/db', () => ({
  db: {
    project: { create: mockProjectCreate, update: mockProjectUpdate, findUnique: () => Promise.resolve(null) },
    projectRuntime: { create: mockRuntimeCreate },
    agent: { create: mockAgentCreate },
    projectMode: { create: mockModeCreate },
    chainTemplate: { create: mockChainTemplateCreate },
    task: { create: mockTaskCreate },
    taskStep: { create: mockTaskStepCreate },
  },
  isPostgresDb: false,
}))

import {
  EXPORT_VERSION,
  toExportBundle,
  redactAgent,
  projectImportBundleSchema,
  importProjectBundle,
} from '../project-export'

beforeEach(() => {
  for (const m of [
    mockProjectCreate, mockProjectUpdate, mockRuntimeCreate, mockAgentCreate,
    mockModeCreate, mockChainTemplateCreate, mockTaskCreate, mockTaskStepCreate,
  ]) m.mockReset()
  mockProjectCreate.mockImplementation((args: any) => Promise.resolve({ id: 'proj-new', ...args.data }))
  mockProjectUpdate.mockImplementation((args: any) => Promise.resolve({ id: args.where.id }))
  mockRuntimeCreate.mockResolvedValue({ id: 'rt-new' })
  mockAgentCreate.mockResolvedValue({ id: 'ag-new' })
  mockModeCreate.mockResolvedValue({ id: 'mode-new' })
  mockChainTemplateCreate.mockResolvedValue({ id: 'ct-new' })
  mockTaskCreate.mockResolvedValue({ id: 'task-new' })
  mockTaskStepCreate.mockResolvedValue({ id: 'step-new' })
})

// Rows carrying EVERY secret column, as they come off Prisma. The whole point
// is to prove none of these survive into the exported bundle.
function secretLadenRows() {
  return {
    project: {
      id: 'p1',
      name: 'Secret Project',
      description: 'desc',
      color: '#111111',
      apiKey: 'sk-live-PROJECT-LEAK',
      apiKeyHash: 'PROJECT-HASH-LEAK',
      apiKeyPreview: 'sk-...LEAK',
      automationMode: 'manual',
      automationSchedule: null,
      automationPollMs: 10000,
      logRetentionDays: null,
      defaultStepMode: 'develop',
      defaultChainTemplateId: 'ct1',
      autoArchiveDays: null,
      reviewEscalationHours: null,
      artifactRetentionDays: null,
      budgetUsd: null,
    },
    agents: [
      {
        id: 'a1',
        name: 'Builder',
        emoji: '🛠️',
        color: '#222',
        role: 'developer',
        systemPrompt: 'You build things.',
        apiKey: 'sk-live-AGENT-LEAK',
        apiKeyHash: 'AGENT-HASH-LEAK',
        apiKeyPreview: 'sk-...AGENT',
        runtimeId: 'rt1',
        invocationMode: 'HTTP',
        isActive: true,
      },
    ],
    modes: [{ name: 'develop', label: 'Develop', color: '#60A5FA' }],
    runtimes: [
      {
        id: 'rt1',
        adapter: 'anthropic',
        name: 'Claude',
        models: '[{"id":"x"}]',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        endpoint: null,
        available: true,
        config: '{"secret":"SHOULD-NOT-LEAK","password":"nope"}',
      },
    ],
    chainTemplates: [
      { id: 'ct1', name: 'Flow', description: null, icon: '🔗', steps: '[{"agentRole":"developer","mode":"develop"}]' },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Do work',
        description: null,
        status: 'BACKLOG',
        priority: 'HIGH',
        order: 0,
        agentId: 'a1',
        steps: [{ id: 's1', order: 0, agentId: 'a1', mode: 'develop', autoContinue: true, status: 'pending' }],
      },
    ],
  }
}

describe('export redaction (the critical test)', () => {
  test('no secret field name or value survives into the serialized bundle', () => {
    const bundle = toExportBundle(secretLadenRows())
    const serialized = JSON.stringify(bundle)

    // Secret FIELD NAMES must not appear anywhere.
    for (const forbidden of ['apiKey', 'apiKeyHash', 'apiKeyPreview', 'tokenHash', 'secret', 'password']) {
      expect(serialized).not.toContain(forbidden)
    }
    // Secret VALUES must not appear anywhere either.
    for (const leak of [
      'sk-live-PROJECT-LEAK', 'PROJECT-HASH-LEAK', 'sk-live-AGENT-LEAK',
      'AGENT-HASH-LEAK', 'SHOULD-NOT-LEAK',
    ]) {
      expect(serialized).not.toContain(leak)
    }
  })

  test('bundle carries version, exportedAt, tasks-with-steps, and agents by name/role/prompt', () => {
    const bundle = toExportBundle(secretLadenRows())

    expect(bundle.version).toBe(EXPORT_VERSION)
    expect(typeof bundle.exportedAt).toBe('string')
    expect(new Date(bundle.exportedAt).toString()).not.toBe('Invalid Date')

    expect(bundle.agents[0]).toMatchObject({
      name: 'Builder', role: 'developer', systemPrompt: 'You build things.',
    })
    expect(bundle.tasks[0].title).toBe('Do work')
    expect(bundle.tasks[0].steps[0]).toMatchObject({ order: 0, mode: 'develop' })
    // runtime env-var NAME is kept under the neutral key (no "apiKey" token)
    expect(bundle.runtimes[0].envVar).toBe('ANTHROPIC_API_KEY')
  })

  test('redactAgent never returns a key field even when the row has one', () => {
    const out = redactAgent({ id: 'a', name: 'A', apiKey: 'x', apiKeyHash: 'y', apiKeyPreview: 'z' } as any)
    expect(Object.keys(out)).not.toContain('apiKey')
    expect(Object.keys(out)).not.toContain('apiKeyHash')
    expect(Object.keys(out)).not.toContain('apiKeyPreview')
  })
})

describe('import bundle validation', () => {
  const goodBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { name: 'P' },
    agents: [], modes: [], runtimes: [], chainTemplates: [], tasks: [],
  }

  test('accepts a well-formed bundle', () => {
    expect(projectImportBundleSchema.safeParse(goodBundle).success).toBe(true)
  })

  test('rejects a bundle with the wrong version', () => {
    expect(projectImportBundleSchema.safeParse({ ...goodBundle, version: 2 }).success).toBe(false)
  })

  test('rejects a bundle missing the project name', () => {
    expect(projectImportBundleSchema.safeParse({ ...goodBundle, project: {} }).success).toBe(false)
  })

  test('strips an injected apiKey off an agent', () => {
    const parsed = projectImportBundleSchema.parse({
      ...goodBundle,
      agents: [{ id: 'a1', name: 'A', apiKey: 'sk-INJECTED', apiKeyHash: 'HASH' }],
    })
    expect(parsed.agents![0]).not.toHaveProperty('apiKey')
    expect(parsed.agents![0]).not.toHaveProperty('apiKeyHash')
  })
})

describe('import id remap', () => {
  test('creates a new project and remaps runtime/agent/task/step references', async () => {
    mockAgentCreate.mockResolvedValue({ id: 'ag-NEW' })
    mockRuntimeCreate.mockResolvedValue({ id: 'rt-NEW' })
    mockChainTemplateCreate.mockResolvedValue({ id: 'ct-NEW' })

    const bundle = projectImportBundleSchema.parse({
      version: 1,
      project: { name: 'Orig', defaultChainTemplateId: 'ct-old' },
      runtimes: [{ id: 'rt-old', adapter: 'anthropic', name: 'Claude', models: '[]', envVar: 'ANTHROPIC_API_KEY' }],
      agents: [{ id: 'ag-old', name: 'Builder', role: 'dev', runtimeId: 'rt-old' }],
      chainTemplates: [{ id: 'ct-old', name: 'Flow', icon: '🔗', steps: '[{"agentId":"ag-old","mode":"develop"}]' }],
      tasks: [
        {
          id: 't-old', title: 'T', agentId: 'ag-old', order: 0,
          steps: [
            { id: 's1', order: 0, agentId: 'ag-old', mode: 'develop', nextSteps: '[{"targetStepId":"s2"}]' },
            { id: 's2', order: 1, mode: 'review', prevSteps: '["s1"]' },
          ],
        },
      ],
    })

    const result = await importProjectBundle(bundle, { workspaceId: 'ws-1' })

    expect(result.name).toBe('Orig (imported)')
    expect(result.counts).toMatchObject({ agents: 1, runtimes: 1, chainTemplates: 1, tasks: 1, steps: 2 })

    // New project, imported name, no secret column.
    const projData = mockProjectCreate.mock.calls[0][0].data
    expect(projData.name).toBe('Orig (imported)')
    expect(projData).not.toHaveProperty('apiKey')
    expect(projData).not.toHaveProperty('apiKeyHash')

    // Agent: runtimeId remapped, inactive, keyless.
    const agentData = mockAgentCreate.mock.calls[0][0].data
    expect(agentData.runtimeId).toBe('rt-NEW')
    expect(agentData.isActive).toBe(false)
    expect(agentData).not.toHaveProperty('apiKey')

    // Task agentId remapped to the new agent id.
    expect(mockTaskCreate.mock.calls[0][0].data.agentId).toBe('ag-NEW')

    // Chain-template step agentId remapped.
    const ctSteps = JSON.parse(mockChainTemplateCreate.mock.calls[0][0].data.steps)
    expect(ctSteps[0].agentId).toBe('ag-NEW')

    // Steps created in order; DAG edges rewritten to the NEW step ids.
    const s1Data = mockTaskStepCreate.mock.calls[0][0].data
    const s2Data = mockTaskStepCreate.mock.calls[1][0].data
    expect(s1Data.agentId).toBe('ag-NEW')
    expect(JSON.parse(s1Data.nextSteps)[0].targetStepId).toBe(s2Data.id)
    expect(JSON.parse(s2Data.prevSteps)[0]).toBe(s1Data.id)
    // ids are freshly minted, not the originals
    expect(s1Data.id).not.toBe('s1')

    // defaultChainTemplateId remapped via a follow-up update.
    expect(mockProjectUpdate.mock.calls[0][0].data.defaultChainTemplateId).toBe('ct-NEW')
  })
})

describe('export → import round-trip', () => {
  test('preserves task/step/agent structure (minus secrets)', async () => {
    mockAgentCreate.mockResolvedValue({ id: 'ag-RT' })

    const exported = toExportBundle(secretLadenRows())
    const serialized = JSON.stringify(exported)
    // Re-parse as if uploaded, then import.
    const parsed = projectImportBundleSchema.parse(JSON.parse(serialized))

    const result = await importProjectBundle(parsed, { workspaceId: 'ws-1' })

    expect(result.counts).toMatchObject({ agents: 1, tasks: 1, steps: 1, modes: 1, runtimes: 1, chainTemplates: 1 })
    expect(mockAgentCreate.mock.calls[0][0].data.name).toBe('Builder')
    expect(mockTaskCreate.mock.calls[0][0].data.title).toBe('Do work')
    expect(mockTaskStepCreate.mock.calls[0][0].data.mode).toBe('develop')
    // The imported agent's task reference resolves to the new agent id.
    expect(mockTaskCreate.mock.calls[0][0].data.agentId).toBe('ag-RT')
  })
})
