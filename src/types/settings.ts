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
