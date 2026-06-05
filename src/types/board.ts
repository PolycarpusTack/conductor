export type TaskStatus = 'BACKLOG' | 'IN_PROGRESS' | 'WAITING' | 'REVIEW' | 'DONE'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface Agent {
  id: string
  name: string
  emoji: string
  color: string
  description?: string | null
  isActive: boolean
  lastSeen?: string | null
  role?: string | null
  capabilities?: string | null
  maxConcurrent: number
  supportedModes?: string | null
  modeInstructions?: string | null
  invocationMode?: string | null
  runtimeId?: string | null
  runtimeModel?: string | null
  systemPrompt?: string | null
  mcpConnectionIds?: string | null
  personality?: string | null
}

export interface TaskStepSummary {
  id: string
  order: number
  mode: string
  status: string
  agentId: string | null
  humanLabel: string | null
  autoContinue: boolean
  rejectionNote: string | null
  attempts: number
  agent: { id: string; name: string; emoji: string } | null
}

export interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  tag?: string
  notes?: string
  output?: string
  agent?: Agent | null
  order: number
  startedAt?: string | null
  completedAt?: string | null
  runtimeOverride?: string | null
  steps?: TaskStepSummary[]
  createdAt?: string
}

export interface Project {
  id: string
  name: string
  description?: string | null
  color: string
  agents: Agent[]
  tasks: Task[]
}

export interface ProjectListItem {
  id: string
  name: string
  description?: string
  color: string
}

export interface Activity {
  id: string
  action: string
  taskId?: string
  agentId?: string
  agent?: { name: string; emoji: string }
  details?: string
  createdAt: string
}
