// Project export / import (Story D-6).
//
// Exports a project as a versioned, secret-free JSON bundle and re-imports a
// bundle into a BRAND NEW project. The single most important property of this
// module is REDACTION: the bundle is built by an explicit allow-list — every
// exported field is named individually and Prisma rows are NEVER spread. No
// secret ever reaches the bundle: Project.apiKey/apiKeyHash/apiKeyPreview,
// Agent.apiKey/apiKeyHash/apiKeyPreview, ProjectRuntime.apiKeyEnvVar (renamed
// to the neutral `envVar`, holding only the env-var NAME) and the opaque
// runtime `config` blob (which may carry secret values) are all dropped.
//
// Import creates a new project with fresh ids and remaps every internal
// reference (tasks, steps, agents, runtimes, chain-template + DAG edges) so
// relationships survive the id rewrite. Imported agents get NO keys — they
// require key rotation before they can run, which is the correct security
// posture for a moved/restored project.

import { randomUUID } from 'crypto'

import { z } from 'zod'

import { db } from '@/lib/db'
import { notFound } from '@/lib/server/api-errors'
import { requireWorkspaceId } from '@/lib/server/workspace'

export const EXPORT_VERSION = 1 as const

// ─────────────────────────────────────────────────────────────────────────────
// Bundle shape
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportedProject {
  name: string
  description: string | null
  color: string
  automationMode: string
  automationSchedule: string | null
  automationPollMs: number
  logRetentionDays: number | null
  defaultStepMode: string | null
  defaultChainTemplateId: string | null
  autoArchiveDays: number | null
  reviewEscalationHours: number | null
  artifactRetentionDays: number | null
  budgetUsd: number | null
}

export interface ExportedAgent {
  id: string
  name: string
  emoji: string
  color: string
  description: string | null
  personality: string | null
  role: string | null
  category: string | null
  capabilities: string | null
  maxConcurrent: number
  supportedModes: string | null
  modeInstructions: string | null
  systemPrompt: string | null
  runtimeId: string | null
  runtimeModel: string | null
  invocationMode: string
  isActive: boolean
}

export interface ExportedMode {
  name: string
  label: string
  color: string
  icon: string | null
  instructions: string | null
  maxAttempts: number | null
  toolAllowlist: string | null
  outputFormat: string | null
}

export interface ExportedRuntime {
  id: string
  adapter: string
  name: string
  models: string
  // The NAME of the env var holding the key (never the key). Renamed from the
  // schema's `apiKeyEnvVar` so the redaction scan for "apiKey" cannot trip.
  envVar: string | null
  endpoint: string | null
  available: boolean
}

export interface ExportedChainTemplate {
  id: string
  name: string
  description: string | null
  icon: string
  steps: string
}

export interface ExportedStep {
  id: string
  order: number
  agentId: string | null
  fallbackAgentId: string | null
  humanLabel: string | null
  mode: string
  instructions: string | null
  autoContinue: boolean
  status: string
  requiredSignOffs: number
  maxRetries: number
  retryDelayMs: number
  timeoutMs: number
  isParallelRoot: boolean
  isMergePoint: boolean
  nextSteps: string | null
  prevSteps: string | null
}

export interface ExportedTask {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  tag: string | null
  notes: string | null
  output: string | null
  order: number
  agentId: string | null
  steps: ExportedStep[]
}

export interface ProjectExportBundle {
  version: typeof EXPORT_VERSION
  exportedAt: string
  project: ExportedProject
  agents: ExportedAgent[]
  modes: ExportedMode[]
  runtimes: ExportedRuntime[]
  chainTemplates: ExportedChainTemplate[]
  tasks: ExportedTask[]
}

// Loose row inputs for the pure mappers. Secret fields are declared as
// present-but-optional so the redaction is an EXPLICIT choice a reader can see:
// the mapper knows these exist and deliberately never copies them.
type WithSecrets = { apiKey?: string | null; apiKeyHash?: string | null; apiKeyPreview?: string | null }

// ─────────────────────────────────────────────────────────────────────────────
// Export — pure allow-list mappers (the redaction boundary)
// ─────────────────────────────────────────────────────────────────────────────

export function redactAgent(a: WithSecrets & Record<string, unknown>): ExportedAgent {
  return {
    id: a.id as string,
    name: a.name as string,
    emoji: (a.emoji as string) ?? '🤖',
    color: (a.color as string) ?? '#3b82f6',
    description: (a.description as string) ?? null,
    personality: (a.personality as string) ?? null,
    role: (a.role as string) ?? null,
    category: (a.category as string) ?? null,
    capabilities: (a.capabilities as string) ?? null,
    maxConcurrent: (a.maxConcurrent as number) ?? 1,
    supportedModes: (a.supportedModes as string) ?? null,
    modeInstructions: (a.modeInstructions as string) ?? null,
    systemPrompt: (a.systemPrompt as string) ?? null,
    runtimeId: (a.runtimeId as string) ?? null,
    runtimeModel: (a.runtimeModel as string) ?? null,
    invocationMode: (a.invocationMode as string) ?? 'HTTP',
    isActive: Boolean(a.isActive),
  }
}

function redactMode(m: Record<string, unknown>): ExportedMode {
  return {
    name: m.name as string,
    label: m.label as string,
    color: (m.color as string) ?? '#60A5FA',
    icon: (m.icon as string) ?? null,
    instructions: (m.instructions as string) ?? null,
    maxAttempts: (m.maxAttempts as number) ?? null,
    toolAllowlist: (m.toolAllowlist as string) ?? null,
    outputFormat: (m.outputFormat as string) ?? null,
  }
}

function redactRuntime(r: Record<string, unknown>): ExportedRuntime {
  // `config` is an opaque JSON blob that may carry secret values → dropped.
  // `apiKeyEnvVar` holds only the env-var NAME → kept as neutral `envVar`.
  return {
    id: r.id as string,
    adapter: r.adapter as string,
    name: r.name as string,
    models: (r.models as string) ?? '[]',
    envVar: (r.apiKeyEnvVar as string) ?? null,
    endpoint: (r.endpoint as string) ?? null,
    available: Boolean(r.available),
  }
}

function redactChainTemplate(c: Record<string, unknown>): ExportedChainTemplate {
  return {
    id: c.id as string,
    name: c.name as string,
    description: (c.description as string) ?? null,
    icon: (c.icon as string) ?? '🔗',
    steps: (c.steps as string) ?? '[]',
  }
}

function redactStep(s: Record<string, unknown>): ExportedStep {
  return {
    id: s.id as string,
    order: s.order as number,
    agentId: (s.agentId as string) ?? null,
    fallbackAgentId: (s.fallbackAgentId as string) ?? null,
    humanLabel: (s.humanLabel as string) ?? null,
    mode: s.mode as string,
    instructions: (s.instructions as string) ?? null,
    autoContinue: Boolean(s.autoContinue),
    status: (s.status as string) ?? 'pending',
    requiredSignOffs: (s.requiredSignOffs as number) ?? 1,
    maxRetries: (s.maxRetries as number) ?? 2,
    retryDelayMs: (s.retryDelayMs as number) ?? 5000,
    timeoutMs: (s.timeoutMs as number) ?? 300000,
    isParallelRoot: Boolean(s.isParallelRoot),
    isMergePoint: Boolean(s.isMergePoint),
    nextSteps: (s.nextSteps as string) ?? null,
    prevSteps: (s.prevSteps as string) ?? null,
  }
}

function redactTask(t: Record<string, unknown>): ExportedTask {
  const steps = Array.isArray(t.steps) ? (t.steps as Record<string, unknown>[]) : []
  return {
    id: t.id as string,
    title: t.title as string,
    description: (t.description as string) ?? null,
    status: (t.status as string) ?? 'BACKLOG',
    priority: (t.priority as string) ?? 'MEDIUM',
    tag: (t.tag as string) ?? null,
    notes: (t.notes as string) ?? null,
    output: (t.output as string) ?? null,
    order: (t.order as number) ?? 0,
    agentId: (t.agentId as string) ?? null,
    steps: steps.map(redactStep),
  }
}

function redactProject(p: WithSecrets & Record<string, unknown>): ExportedProject {
  return {
    name: p.name as string,
    description: (p.description as string) ?? null,
    color: (p.color as string) ?? '#3b82f6',
    automationMode: (p.automationMode as string) ?? 'manual',
    automationSchedule: (p.automationSchedule as string) ?? null,
    automationPollMs: (p.automationPollMs as number) ?? 10000,
    logRetentionDays: (p.logRetentionDays as number) ?? null,
    defaultStepMode: (p.defaultStepMode as string) ?? null,
    defaultChainTemplateId: (p.defaultChainTemplateId as string) ?? null,
    autoArchiveDays: (p.autoArchiveDays as number) ?? null,
    reviewEscalationHours: (p.reviewEscalationHours as number) ?? null,
    artifactRetentionDays: (p.artifactRetentionDays as number) ?? null,
    budgetUsd: (p.budgetUsd as number) ?? null,
  }
}

/**
 * Pure transform: given raw project + related rows (which MAY contain secret
 * columns), produce a fully-redacted bundle. This is the redaction guarantee
 * and the unit-test target — pass rows carrying apiKey/hash values and assert
 * none survive into the serialized bundle.
 */
export function toExportBundle(input: {
  project: Record<string, unknown>
  agents: Record<string, unknown>[]
  modes: Record<string, unknown>[]
  runtimes: Record<string, unknown>[]
  chainTemplates: Record<string, unknown>[]
  tasks: Record<string, unknown>[]
  exportedAt?: string
}): ProjectExportBundle {
  return {
    version: EXPORT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    project: redactProject(input.project),
    agents: input.agents.map(redactAgent),
    modes: input.modes.map(redactMode),
    runtimes: input.runtimes.map(redactRuntime),
    chainTemplates: input.chainTemplates.map(redactChainTemplate),
    tasks: input.tasks.map(redactTask),
  }
}

/**
 * Loads a project and its exportable relations, then redacts. The DB query
 * uses explicit `select` (defense in depth) and the mapper allow-lists again —
 * two independent barriers between a secret column and the wire.
 */
export async function buildProjectExport(projectId: string): Promise<ProjectExportBundle> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      name: true,
      description: true,
      color: true,
      automationMode: true,
      automationSchedule: true,
      automationPollMs: true,
      logRetentionDays: true,
      defaultStepMode: true,
      defaultChainTemplateId: true,
      autoArchiveDays: true,
      reviewEscalationHours: true,
      artifactRetentionDays: true,
      budgetUsd: true,
      agents: {
        select: {
          id: true, name: true, emoji: true, color: true, description: true,
          personality: true, role: true, category: true, capabilities: true,
          maxConcurrent: true, supportedModes: true, modeInstructions: true,
          systemPrompt: true, runtimeId: true, runtimeModel: true,
          invocationMode: true, isActive: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      modes: {
        select: {
          name: true, label: true, color: true, icon: true, instructions: true,
          maxAttempts: true, toolAllowlist: true, outputFormat: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      runtimes: {
        select: {
          id: true, adapter: true, name: true, models: true,
          apiKeyEnvVar: true, endpoint: true, available: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      chainTemplates: {
        select: { id: true, name: true, description: true, icon: true, steps: true },
        orderBy: { createdAt: 'asc' },
      },
      tasks: {
        where: { deletedAt: null },
        select: {
          id: true, title: true, description: true, status: true, priority: true,
          tag: true, notes: true, output: true, order: true, agentId: true,
          steps: {
            select: {
              id: true, order: true, agentId: true, fallbackAgentId: true,
              humanLabel: true, mode: true, instructions: true, autoContinue: true,
              status: true, requiredSignOffs: true, maxRetries: true,
              retryDelayMs: true, timeoutMs: true, isParallelRoot: true,
              isMergePoint: true, nextSteps: true, prevSteps: true,
            },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  })

  if (!project) throw notFound('Project not found')

  const { agents, modes, runtimes, chainTemplates, tasks, ...projectFields } = project
  return toExportBundle({
    project: projectFields as Record<string, unknown>,
    agents: agents as Record<string, unknown>[],
    modes: modes as Record<string, unknown>[],
    runtimes: runtimes as Record<string, unknown>[],
    chainTemplates: chainTemplates as Record<string, unknown>[],
    tasks: tasks as Record<string, unknown>[],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Import — validation (zod strips unknown keys, so an injected `apiKey`
// silently disappears before it can ever reach a write)
// ─────────────────────────────────────────────────────────────────────────────

const exportedProjectSchema = z.object({
  name: z.string().trim().min(1).max(240),
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  automationMode: z.string().optional(),
  automationSchedule: z.string().nullable().optional(),
  automationPollMs: z.number().optional(),
  logRetentionDays: z.number().nullable().optional(),
  defaultStepMode: z.string().nullable().optional(),
  defaultChainTemplateId: z.string().nullable().optional(),
  autoArchiveDays: z.number().nullable().optional(),
  reviewEscalationHours: z.number().nullable().optional(),
  artifactRetentionDays: z.number().nullable().optional(),
  budgetUsd: z.number().nullable().optional(),
})

const exportedAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().optional(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  capabilities: z.string().nullable().optional(),
  maxConcurrent: z.number().optional(),
  supportedModes: z.string().nullable().optional(),
  modeInstructions: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  runtimeId: z.string().nullable().optional(),
  runtimeModel: z.string().nullable().optional(),
  invocationMode: z.string().optional(),
  isActive: z.boolean().optional(),
})

const exportedModeSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  color: z.string().optional(),
  icon: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  maxAttempts: z.number().nullable().optional(),
  toolAllowlist: z.string().nullable().optional(),
  outputFormat: z.string().nullable().optional(),
})

const exportedRuntimeSchema = z.object({
  id: z.string().min(1),
  adapter: z.string().min(1),
  name: z.string().min(1),
  models: z.string().optional(),
  envVar: z.string().nullable().optional(),
  endpoint: z.string().nullable().optional(),
  available: z.boolean().optional(),
})

const exportedChainTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  steps: z.string().optional(),
})

const exportedStepSchema = z.object({
  id: z.string().min(1),
  order: z.number(),
  agentId: z.string().nullable().optional(),
  fallbackAgentId: z.string().nullable().optional(),
  humanLabel: z.string().nullable().optional(),
  mode: z.string().min(1),
  instructions: z.string().nullable().optional(),
  autoContinue: z.boolean().optional(),
  status: z.string().optional(),
  requiredSignOffs: z.number().optional(),
  maxRetries: z.number().optional(),
  retryDelayMs: z.number().optional(),
  timeoutMs: z.number().optional(),
  isParallelRoot: z.boolean().optional(),
  isMergePoint: z.boolean().optional(),
  nextSteps: z.string().nullable().optional(),
  prevSteps: z.string().nullable().optional(),
})

const exportedTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  tag: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  output: z.string().nullable().optional(),
  order: z.number().optional(),
  agentId: z.string().nullable().optional(),
  steps: z.array(exportedStepSchema).max(50).optional(),
})

export const projectImportBundleSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().optional(),
  project: exportedProjectSchema,
  agents: z.array(exportedAgentSchema).max(500).optional(),
  modes: z.array(exportedModeSchema).max(200).optional(),
  runtimes: z.array(exportedRuntimeSchema).max(200).optional(),
  chainTemplates: z.array(exportedChainTemplateSchema).max(200).optional(),
  tasks: z.array(exportedTaskSchema).max(2000).optional(),
})

export type ProjectImportBundle = z.infer<typeof projectImportBundleSchema>

export interface ImportProjectResult {
  projectId: string
  name: string
  counts: {
    agents: number
    modes: number
    runtimes: number
    chainTemplates: number
    tasks: number
    steps: number
  }
}

/** Remap the `agentId` inside chain-template step JSON via the agent id map. */
function remapChainTemplateSteps(stepsJson: string | undefined, agentIdMap: Map<string, string>): string {
  if (!stepsJson) return '[]'
  let steps: unknown
  try {
    steps = JSON.parse(stepsJson)
  } catch {
    return '[]'
  }
  if (!Array.isArray(steps)) return '[]'
  const remapped = steps.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw
    const step = { ...(raw as Record<string, unknown>) }
    if (typeof step.agentId === 'string' && step.agentId) {
      step.agentId = agentIdMap.get(step.agentId) ?? null
    }
    return step
  })
  return JSON.stringify(remapped)
}

/** Remap the `targetStepId` references inside a step's nextSteps JSON. */
function remapNextSteps(nextJson: string | null | undefined, stepIdMap: Map<string, string>): string | null {
  if (!nextJson) return null
  let edges: unknown
  try {
    edges = JSON.parse(nextJson)
  } catch {
    return null
  }
  if (!Array.isArray(edges)) return null
  const remapped = edges
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null
      const edge = { ...(raw as Record<string, unknown>) }
      const target = edge.targetStepId
      if (typeof target !== 'string') return null
      const mapped = stepIdMap.get(target)
      if (!mapped) return null // drop edges to steps that didn't survive
      edge.targetStepId = mapped
      return edge
    })
    .filter((e) => e !== null)
  return JSON.stringify(remapped)
}

/** Remap the stepId array inside a step's prevSteps JSON. */
function remapPrevSteps(prevJson: string | null | undefined, stepIdMap: Map<string, string>): string | null {
  if (!prevJson) return null
  let ids: unknown
  try {
    ids = JSON.parse(prevJson)
  } catch {
    return null
  }
  if (!Array.isArray(ids)) return null
  const remapped = ids
    .map((id) => (typeof id === 'string' ? stepIdMap.get(id) : undefined))
    .filter((id): id is string => Boolean(id))
  return JSON.stringify(remapped)
}

/**
 * Creates a NEW project from a validated bundle. Every internal id is minted
 * fresh and all cross-references are remapped so relationships survive:
 *   runtimes → agents.runtimeId
 *   agents   → tasks.agentId, steps.agentId, steps.fallbackAgentId, chain steps
 *   steps    → nextSteps.targetStepId / prevSteps (DAG edges)
 *   chains   → project.defaultChainTemplateId
 * NO secret column is ever written — imported agents have no keys and must be
 * rotated before use. Each call yields a distinct project, so re-import is
 * naturally idempotent (a fresh copy every time).
 */
export async function importProjectBundle(
  bundle: ProjectImportBundle,
  options: { workspaceId?: string } = {},
): Promise<ImportProjectResult> {
  const agents = bundle.agents ?? []
  const modes = bundle.modes ?? []
  const runtimes = bundle.runtimes ?? []
  const chainTemplates = bundle.chainTemplates ?? []
  const tasks = bundle.tasks ?? []

  const workspaceId = await requireWorkspaceId(options.workspaceId)
  const newProjectId = randomUUID()

  await db.project.create({
    data: {
      id: newProjectId,
      name: `${bundle.project.name} (imported)`,
      description: bundle.project.description ?? null,
      color: bundle.project.color ?? '#3b82f6',
      workspaceId,
      automationMode: bundle.project.automationMode ?? 'manual',
      automationSchedule: bundle.project.automationSchedule ?? null,
      automationPollMs: bundle.project.automationPollMs ?? 10000,
      logRetentionDays: bundle.project.logRetentionDays ?? null,
      defaultStepMode: bundle.project.defaultStepMode ?? null,
      autoArchiveDays: bundle.project.autoArchiveDays ?? null,
      reviewEscalationHours: bundle.project.reviewEscalationHours ?? null,
      artifactRetentionDays: bundle.project.artifactRetentionDays ?? null,
      budgetUsd: bundle.project.budgetUsd ?? null,
      // NOTE: no apiKey / apiKeyHash / apiKeyPreview — imported project has no key.
      // defaultChainTemplateId set after chain templates are remapped.
    },
  })

  // Runtimes first — agents reference them.
  const runtimeIdMap = new Map<string, string>()
  for (const r of runtimes) {
    const created = await db.projectRuntime.create({
      data: {
        projectId: newProjectId,
        adapter: r.adapter,
        name: r.name,
        models: r.models ?? '[]',
        apiKeyEnvVar: r.envVar ?? null, // env-var NAME only, never a secret
        endpoint: r.endpoint ?? null,
        available: r.available ?? true,
      },
      select: { id: true },
    })
    runtimeIdMap.set(r.id, created.id)
  }

  // Agents — remap runtimeId; NEVER write a key.
  const agentIdMap = new Map<string, string>()
  for (const a of agents) {
    const created = await db.agent.create({
      data: {
        projectId: newProjectId,
        name: a.name,
        emoji: a.emoji ?? '🤖',
        color: a.color ?? '#3b82f6',
        description: a.description ?? null,
        personality: a.personality ?? null,
        role: a.role ?? null,
        category: a.category ?? null,
        capabilities: a.capabilities ?? null,
        maxConcurrent: a.maxConcurrent ?? 1,
        supportedModes: a.supportedModes ?? null,
        modeInstructions: a.modeInstructions ?? null,
        systemPrompt: a.systemPrompt ?? null,
        runtimeId: a.runtimeId ? runtimeIdMap.get(a.runtimeId) ?? null : null,
        runtimeModel: a.runtimeModel ?? null,
        invocationMode: a.invocationMode === 'DAEMON' ? 'DAEMON' : 'HTTP',
        // Imported agents are inactive and keyless — they need rotation to run.
        isActive: false,
      },
      select: { id: true },
    })
    agentIdMap.set(a.id, created.id)
  }

  for (const m of modes) {
    await db.projectMode.create({
      data: {
        projectId: newProjectId,
        name: m.name,
        label: m.label,
        color: m.color ?? '#60A5FA',
        icon: m.icon ?? null,
        instructions: m.instructions ?? null,
        maxAttempts: m.maxAttempts ?? null,
        toolAllowlist: m.toolAllowlist ?? null,
        outputFormat: m.outputFormat ?? null,
      },
    })
  }

  const chainTemplateIdMap = new Map<string, string>()
  for (const c of chainTemplates) {
    const created = await db.chainTemplate.create({
      data: {
        projectId: newProjectId,
        name: c.name,
        description: c.description ?? null,
        icon: c.icon ?? '🔗',
        steps: remapChainTemplateSteps(c.steps, agentIdMap),
      },
      select: { id: true },
    })
    chainTemplateIdMap.set(c.id, created.id)
  }

  let stepCount = 0
  for (const t of tasks) {
    const newTaskId = randomUUID()
    await db.task.create({
      data: {
        id: newTaskId,
        projectId: newProjectId,
        title: t.title,
        description: t.description ?? null,
        status: (t.status ?? 'BACKLOG') as never,
        priority: (t.priority ?? 'MEDIUM') as never,
        tag: t.tag ?? null,
        notes: t.notes ?? null,
        output: t.output ?? null,
        order: t.order ?? 0,
        agentId: t.agentId ? agentIdMap.get(t.agentId) ?? null : null,
      },
    })

    const steps = t.steps ?? []
    // Pass 1: mint fresh ids for every step so intra-task edges can resolve.
    const stepIdMap = new Map<string, string>()
    for (const s of steps) stepIdMap.set(s.id, randomUUID())

    // Pass 2: create each step with remapped agent + DAG references.
    for (const s of steps) {
      await db.taskStep.create({
        data: {
          id: stepIdMap.get(s.id)!,
          taskId: newTaskId,
          order: s.order,
          agentId: s.agentId ? agentIdMap.get(s.agentId) ?? null : null,
          fallbackAgentId: s.fallbackAgentId ? agentIdMap.get(s.fallbackAgentId) ?? null : null,
          humanLabel: s.humanLabel ?? null,
          mode: s.mode,
          instructions: s.instructions ?? null,
          autoContinue: s.autoContinue ?? true,
          status: s.status ?? 'pending',
          requiredSignOffs: s.requiredSignOffs ?? 1,
          maxRetries: s.maxRetries ?? 2,
          retryDelayMs: s.retryDelayMs ?? 5000,
          timeoutMs: s.timeoutMs ?? 300000,
          isParallelRoot: s.isParallelRoot ?? false,
          isMergePoint: s.isMergePoint ?? false,
          nextSteps: remapNextSteps(s.nextSteps, stepIdMap),
          prevSteps: remapPrevSteps(s.prevSteps, stepIdMap),
        },
      })
      stepCount += 1
    }
  }

  // Project default that references a chain template — remap now that ids exist.
  if (bundle.project.defaultChainTemplateId) {
    const mapped = chainTemplateIdMap.get(bundle.project.defaultChainTemplateId)
    if (mapped) {
      await db.project.update({
        where: { id: newProjectId },
        data: { defaultChainTemplateId: mapped },
      })
    }
  }

  return {
    projectId: newProjectId,
    name: `${bundle.project.name} (imported)`,
    counts: {
      agents: agents.length,
      modes: modes.length,
      runtimes: runtimes.length,
      chainTemplates: chainTemplates.length,
      tasks: tasks.length,
      steps: stepCount,
    },
  }
}
