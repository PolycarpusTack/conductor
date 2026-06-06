import type { StepEdge } from '@/lib/server/condition-evaluator'

export type { StepEdge }

export interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
  icon?: string | null
  instructions?: string | null
  maxAttempts?: number | null
  toolAllowlist?: string | null // JSON string[] of namespaced tool patterns
  outputFormat?: string | null
}

// Task templates (Epic S6): saved task-form defaults for the create dialog
export interface TaskTemplate {
  id: string
  name: string
  icon?: string | null
  titlePattern?: string | null // {date} expands to YYYY-MM-DD at pick time
  description?: string | null
  priority?: string | null
  tag?: string | null
  notes?: string | null
  chainTemplateId?: string | null
}

export interface RuntimeModel {
  id: string
  name: string
  tier?: string
}

// `models` and `config` are stored as JSON strings in the DB
export interface ProjectRuntime {
  id: string
  adapter: string
  name: string
  models: string
  apiKeyEnvVar?: string | null
  endpoint?: string | null
  config?: string | null
  available?: boolean
}

export interface ProjectMcpConnection {
  id: string
  name: string
  type: string
  icon?: string | null
  endpoint?: string | null
  config?: string | null
  scopes?: string | null
}

// `steps` is a JSON string in the DB; `icon` always has a default ("🔗")
export interface ChainTemplate {
  id: string
  name: string
  description?: string | null
  icon: string
  projectId?: string
  steps: string
  createdAt?: string
  updatedAt?: string
}

export interface StepDraft {
  agentId?: string | null
  agentRole?: string // library chains reference agents by role; resolved to agentId at selection/creation
  humanLabel?: string
  mode: string
  instructions?: string
  autoContinue: boolean
  maxRetries?: number
  retryDelayMs?: number
  timeoutMs?: number
  nextSteps?: StepEdge[]
  prevSteps?: string[]
  isParallelRoot?: boolean
  isMergePoint?: boolean
  fallbackAgentId?: string | null
}
