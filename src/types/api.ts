/**
 * Request/response shapes for REST endpoints that have no existing interface
 * in `@/types/board` or `@/types/settings` (E-2a typed API client).
 * Shapes mirror what the route handlers actually return today.
 */

import type { StepDraft } from '@/types/settings'
import type { ProjectListItem, Task, TaskPriority, TaskStatus } from '@/types/board'

// --- Generic ---

/** Standard body of destructive endpoints (task/agent delete). */
export interface ApiSuccessResponse {
  success: boolean
}

// --- Projects ---

export interface CreateProjectBody {
  name: string
  description?: string
  color?: string
}

/** POST /api/projects — list item plus the freshly provisioned raw key. */
export type CreateProjectResponse = ProjectListItem & { apiKey: string }

// --- Tasks ---

export interface CreateTaskBody {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  tag?: string
  agentId?: string
  notes?: string
  /** D-2: ISO datetime string (end-of-day UTC) or omit for none. */
  dueDate?: string
  runtimeOverride?: string
  projectId: string
  steps?: StepDraft[]
}

export interface UpdateTaskBody {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  tag?: string
  agentId?: string | null
  notes?: string
  /** D-2: ISO datetime string to set, or null to clear the due date. */
  dueDate?: string | null
  runtimeOverride?: string | null
}

// --- Bulk task operations (D-3) ---

export type BatchTaskAction = 'move' | 'archive' | 'delete'

/** POST /api/tasks/batch — all ids must belong to one project. */
export interface BatchTaskBody {
  action: BatchTaskAction
  taskIds: string[]
  /** Required when action === 'move'. */
  status?: TaskStatus
}

export interface BatchTaskResponse {
  success: boolean
  action: BatchTaskAction
  status?: TaskStatus
  /** Ids actually mutated. */
  affected: string[]
  /** Ids that were a no-op (already deleted/archived, already at status, unknown). */
  skipped: string[]
  /** Refreshed task objects for a move (empty for archive/delete). */
  tasks: Task[]
}

// --- API keys ---

/** GET /api/projects/[id]/key and /api/agents/[id]/key */
export interface ApiKeyPreviewResponse {
  preview: string | null
  revealable: boolean
}

/** POST (rotate) /api/projects/[id]/key and /api/agents/[id]/key */
export interface ApiKeyRotationResponse {
  apiKey: string
  preview: string | null
}

/** GET /api/admin/security/keys */
export interface LegacyApiKeyStatus {
  projectsWithPlaintext: number
  agentsWithPlaintext: number
  totalWithPlaintext: number
}

/** POST /api/admin/security/keys */
export interface LegacyApiKeyMigrationResponse {
  migratedProjects: number
  migratedAgents: number
  totalMigrated: number
  status: LegacyApiKeyStatus
}

// --- Misc ---

/** POST /api/seed — fresh-seed and already-seeded/backfill shapes. */
export interface SeedResponse {
  message: string
  success?: boolean
  projectsUpdated?: number
  project?: { id: string; name: string }
  agents?: { id: string; name: string }[]
  tasksCount?: number
}

/** GET /api/realtime/token — token absent when realtime is not configured. */
export interface RealtimeTokenResponse {
  configured: boolean
  token?: string
}
