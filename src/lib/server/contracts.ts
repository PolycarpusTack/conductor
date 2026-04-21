import { z } from 'zod'

const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'Expected a hex color like #3b82f6')

// Three-state string field: undefined = "don't change on update", null = "clear
// this column", string = "set to this value". Empty-after-trim is mapped to
// null so an emptied UI field actually clears the DB column; before this
// transform was introduced, "" silently collapsed to undefined and updates
// could not clear the field.
const trimmedOptionalString = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional()
  .transform((value) => {
    if (value === '') return null
    return value
  })

export const taskStatusSchema = z.enum(['BACKLOG', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'DONE'])
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: trimmedOptionalString,
  color: colorSchema.optional(),
  workspaceId: z.string().trim().min(1).optional(),
})

export const updateProjectSchema = createProjectSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one project field to update',
)

export const agentRoleSchema = z.enum([
  'developer', 'architect', 'security', 'reviewer', 'qa', 'analyst', 'writer', 'researcher', 'support', 'custom'
])

export const agentInvocationModeSchema = z.enum(['HTTP', 'DAEMON'])

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  personality: z.string().trim().max(280).optional(),
  projectId: z.string().trim().min(1),
  role: agentRoleSchema.optional(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional(),
  modeInstructions: z.record(z.string(), z.string().max(5000)).optional(),
  runtimeId: z.string().trim().min(1).optional(),
  runtimeModel: z.string().trim().max(120).optional(),
  systemPrompt: z.string().max(10000).optional(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional(),
  invocationMode: agentInvocationModeSchema.optional(),
})

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  personality: z.string().trim().max(280).optional().nullable(),
  role: agentRoleSchema.optional().nullable(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  modeInstructions: z.record(z.string(), z.string().max(5000)).optional().nullable(),
  runtimeId: z.string().trim().min(1).optional().nullable(),
  runtimeModel: z.string().trim().max(120).optional().nullable(),
  systemPrompt: z.string().max(10000).optional().nullable(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional().nullable(),
  invocationMode: agentInvocationModeSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field')

export const stepConditionSchema = z.object({
  field: z.enum(['output', 'status', 'tokensUsed', 'error']),
  operator: z.enum(['contains', 'not_contains', 'equals', 'gt', 'lt', 'matches']),
  value: z.string(),
})

export const stepEdgeSchema = z.object({
  targetStepId: z.string(),
  condition: stepConditionSchema.optional(),
  label: z.string().max(60).optional(),
})

export const taskStepSchema = z.object({
  agentId: z.string().trim().min(1).optional().nullable(),
  humanLabel: z.string().trim().max(120).optional(),
  mode: z.string().trim().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(300000).optional(),
  timeoutMs: z.number().int().min(5000).max(600000).optional(),
  // DAG fields
  nextSteps: z.array(stepEdgeSchema).max(10).optional(),
  prevSteps: z.array(z.string()).max(10).optional(),
  isParallelRoot: z.boolean().optional(),
  isMergePoint: z.boolean().optional(),
  fallbackAgentId: z.string().trim().min(1).optional().nullable(),
  requiredSignOffs: z.number().int().min(1).max(10).optional(),
})

export const runtimeOverrideSchema = z.enum(['claude-code', 'codex', 'copilot'])

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: trimmedOptionalString,
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  tag: z.string().trim().max(60).optional().nullable().transform((value) => value || undefined),
  projectId: z.string().trim().min(1),
  agentId: z.string().trim().min(1).optional().nullable().transform((value) => value || undefined),
  notes: trimmedOptionalString,
  steps: z.array(taskStepSchema).max(10).optional(),
  runtimeOverride: runtimeOverrideSchema.optional().nullable(),
})

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: trimmedOptionalString,
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    tag: z.string().trim().max(60).optional().nullable().transform((value) => value || undefined),
    agentId: z.string().trim().min(1).optional().nullable(),
    notes: trimmedOptionalString,
    order: z.number().int().min(0).optional(),
    runtimeOverride: runtimeOverrideSchema.optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one task field to update')

export const adminLoginSchema = z.object({
  password: z.string().min(1),
})

export const activityQuerySchema = z.object({
  projectId: z.string().trim().min(1),
  limit: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50),
  agentId: z.string().trim().min(1).optional(),
})

export const cliActionSchema = z.enum(['claim', 'start', 'done', 'note', 'review'])

export const agentTaskActionSchema = z.enum([
  'claim',
  'start',
  'progress',
  'complete',
  'review',
  'block',
])

export const createProjectModeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120),
  color: colorSchema.optional(),
  icon: z.string().max(16).optional(),
  instructions: z.string().max(5000).optional(),
})

export const updateProjectModeSchema = createProjectModeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)

export const createProjectRuntimeSchema = z.object({
  adapter: z.enum(['anthropic', 'openai', 'google', 'z-ai', 'github-copilot', 'webhook']),
  name: z.string().trim().min(1).max(120),
  models: z.array(z.object({
    id: z.string(),
    name: z.string(),
    tier: z.string().optional(),
  })).min(1),
  apiKeyEnvVar: z.string().max(120).optional(),
  endpoint: z.string().url().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

export const updateProjectRuntimeSchema = createProjectRuntimeSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)

export const createProjectMcpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  icon: z.string().max(16).optional(),
  endpoint: z.string().max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  scopes: z.array(z.string()).optional(),
})

export const updateProjectMcpSchema = createProjectMcpSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field',
)

export const chainTemplateStepSchema = z.object({
  agentId: z.string().optional().nullable(),
  agentRole: z.string().optional(),
  humanLabel: z.string().max(120).optional(),
  mode: z.string().min(1).max(60),
  instructions: z.string().max(5000).optional(),
  autoContinue: z.boolean().default(true),
})

export const createChainTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  icon: z.string().max(16).optional(),
  steps: z.array(chainTemplateStepSchema).min(1).max(10),
})

export const stepReviewSchema = z.object({
  action: z.literal('review'),
  decision: z.enum(['approved', 'rejected', 'revision_requested']),
  note: z.string().max(5000).optional(),
  reviewer: z.string().max(120).default('admin'),
  reassignAgentId: z.string().optional(),
  reassignMode: z.string().optional(),
})

export const rejectStepSchema = z.object({
  action: z.literal('reject'),
  target: z.enum(['redo', 'reassign', 'close']),
  note: z.string().min(1).max(5000),
  reassignAgentId: z.string().optional(),
  reassignMode: z.string().optional(),
})

export const updateChainTemplateSchema = createChainTemplateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')

// ── Skills ──────────────────────────────────────────────────────────────────

export const createSkillSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(1000).optional(),
  body: z.string().min(1).max(50000),
  tags: z.array(z.string().trim().max(60)).max(20).optional(),
  sourceTaskId: z.string().trim().min(1).optional(),
  workspaceId: z.string().trim().min(1).optional(),
})

export const updateSkillSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(1000).optional().nullable(),
  body: z.string().min(1).max(50000).optional(),
  tags: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field')

export const skillSearchSchema = z.object({
  q: z.string().trim().min(1).max(500),
  workspaceId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
})

export const stepArtifactSchema = z.object({
  type: z.enum(['text', 'code', 'diff', 'url', 'image', 'file', 'json', 'log', 'test_result']),
  label: z.string().trim().min(1).max(240),
  content: z.string().max(50000).optional(),
  url: z.string().url().max(2000).optional(),
  mimeType: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

// ── Agent Memory ─────────────────────────────────────────────────────────────

export const memoryCategorySchema = z.enum(['fact', 'decision', 'preference', 'pattern'])

export const createMemorySchema = z.object({
  category: memoryCategorySchema,
  content: z.string().min(1).max(2000),
  sourceTaskId: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.8),
})

export const listMemoriesSchema = z.object({
  projectId: z.string().optional(),
  category: memoryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

// ── Integrations ────────────────────────────────────────────────────────────

export const triggerFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'matches']),
  value: z.string(),
})

export const triggerTypeSchema = z.enum(['event', 'poll:sentry'])

export const eventTypeSchema = z.enum([
  'chain-completed',
  'step-failed',
  'task-created',
  'step-reviewed',
])

export const reactionTypeSchema = z.enum([
  'post:slack',
  'post:http',
  'create:jira',
  'send:email',
])

export const createTriggerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  type: triggerTypeSchema,
  eventType: eventTypeSchema.optional(),
  eventFilters: z.array(triggerFilterSchema).default([]),
  pollConfig: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
})

export const updateTriggerSchema = createTriggerSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field to update',
)

export const createReactionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: reactionTypeSchema,
  config: z.record(z.string(), z.unknown()),
  order: z.number().int().min(0),
  enabled: z.boolean().default(true),
})

export const updateReactionSchema = createReactionSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Provide at least one field to update',
)
