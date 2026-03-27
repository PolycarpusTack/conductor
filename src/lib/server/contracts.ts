import { z } from 'zod'

const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/, 'Expected a hex color like #3b82f6')

const trimmedOptionalString = z
  .string()
  .trim()
  .max(5000)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value) {
      return undefined
    }

    return value
  })

export const taskStatusSchema = z.enum(['BACKLOG', 'IN_PROGRESS', 'WAITING', 'REVIEW', 'DONE'])
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: trimmedOptionalString,
  color: colorSchema.optional(),
})

export const updateProjectSchema = createProjectSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Provide at least one project field to update',
)

export const agentRoleSchema = z.enum([
  'developer', 'researcher', 'writer', 'support', 'qa', 'analyst', 'custom'
])

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
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
})

export const updateAgentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  emoji: z.string().trim().min(1).max(16).optional(),
  color: colorSchema.optional(),
  description: trimmedOptionalString,
  role: agentRoleSchema.optional().nullable(),
  capabilities: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  maxConcurrent: z.number().int().min(1).max(10).optional(),
  supportedModes: z.array(z.string().trim().max(60)).max(20).optional().nullable(),
  modeInstructions: z.record(z.string(), z.string().max(5000)).optional().nullable(),
  runtimeId: z.string().trim().min(1).optional().nullable(),
  runtimeModel: z.string().trim().max(120).optional().nullable(),
  systemPrompt: z.string().max(10000).optional().nullable(),
  mcpConnectionIds: z.array(z.string().trim().min(1)).max(10).optional().nullable(),
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
})

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

export const stepArtifactSchema = z.object({
  type: z.enum(['text', 'code', 'diff', 'url', 'image', 'file', 'json', 'log', 'test_result']),
  label: z.string().trim().min(1).max(240),
  content: z.string().max(50000).optional(),
  url: z.string().url().max(2000).optional(),
  mimeType: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
