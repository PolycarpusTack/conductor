/**
 * Typed wrappers for the REST endpoints consumed by the board hooks (E-2a).
 * Component fetch sites migrate onto these with TanStack Query in E-2b.
 *
 * Wrappers accept an optional `errorFallback` because the fallback message is
 * a call-site UI concern (the same endpoint is toasted differently per flow,
 * e.g. task update vs. drag-and-drop status update).
 */

import type { IntegrationTrigger } from '@/components/settings-integrations'
import type { Activity, Agent, Project, ProjectListItem, Task } from '@/types/board'
import type {
  ChainTemplate,
  ProjectMcpConnection,
  ProjectMode,
  ProjectRuntime,
  TaskTemplate,
} from '@/types/settings'
import type {
  ApiKeyPreviewResponse,
  ApiKeyRotationResponse,
  ApiSuccessResponse,
  CreateProjectBody,
  CreateProjectResponse,
  CreateTaskBody,
  LegacyApiKeyMigrationResponse,
  LegacyApiKeyStatus,
  RealtimeTokenResponse,
  SeedResponse,
  UpdateTaskBody,
} from '@/types/api'
import { apiFetch, type ApiCallOptions } from './client'

export const projectsApi = {
  list: (opts?: ApiCallOptions) =>
    apiFetch<ProjectListItem[]>('/api/projects', { ...opts }),

  get: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<Project>(`/api/projects/${projectId}`, { ...opts }),

  create: (body: CreateProjectBody, opts?: ApiCallOptions) =>
    apiFetch<CreateProjectResponse>('/api/projects', { method: 'POST', body, ...opts }),

  // Settings collections (cache: 'no-store' matches the previous call sites —
  // these back the settings dialog and must never serve stale data).
  modes: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<ProjectMode[]>(`/api/projects/${projectId}/modes`, { cache: 'no-store', ...opts }),

  runtimes: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<ProjectRuntime[]>(`/api/projects/${projectId}/runtimes`, { cache: 'no-store', ...opts }),

  mcpConnections: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<ProjectMcpConnection[]>(`/api/projects/${projectId}/mcp-connections`, { cache: 'no-store', ...opts }),

  chainTemplates: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<ChainTemplate[]>(`/api/projects/${projectId}/chain-templates`, { cache: 'no-store', ...opts }),

  taskTemplates: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<TaskTemplate[]>(`/api/projects/${projectId}/task-templates`, { cache: 'no-store', ...opts }),

  triggers: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<IntegrationTrigger[]>(`/api/projects/${projectId}/triggers`, { ...opts }),

  key: {
    get: (projectId: string, opts?: ApiCallOptions) =>
      apiFetch<ApiKeyPreviewResponse>(`/api/projects/${projectId}/key`, { cache: 'no-store', ...opts }),

    rotate: (projectId: string, opts?: ApiCallOptions) =>
      apiFetch<ApiKeyRotationResponse>(`/api/projects/${projectId}/key`, { method: 'POST', ...opts }),
  },
}

export const tasksApi = {
  create: (body: CreateTaskBody, opts?: ApiCallOptions) =>
    apiFetch<Task>('/api/tasks', { method: 'POST', body, ...opts }),

  update: (taskId: string, body: UpdateTaskBody, opts?: ApiCallOptions) =>
    apiFetch<Task>(`/api/tasks/${taskId}`, { method: 'PUT', body, ...opts }),

  delete: (taskId: string, opts?: ApiCallOptions) =>
    apiFetch<ApiSuccessResponse>(`/api/tasks/${taskId}`, { method: 'DELETE', ...opts }),
}

export const agentsApi = {
  get: (agentId: string, opts?: ApiCallOptions) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { cache: 'no-store', ...opts }),

  delete: (agentId: string, opts?: ApiCallOptions) =>
    apiFetch<ApiSuccessResponse>(`/api/agents/${agentId}`, { method: 'DELETE', ...opts }),

  key: {
    get: (agentId: string, opts?: ApiCallOptions) =>
      apiFetch<ApiKeyPreviewResponse>(`/api/agents/${agentId}/key`, { cache: 'no-store', ...opts }),

    rotate: (agentId: string, opts?: ApiCallOptions) =>
      apiFetch<ApiKeyRotationResponse>(`/api/agents/${agentId}/key`, { method: 'POST', ...opts }),
  },
}

export const activityApi = {
  list: (projectId: string, limit: number, opts?: ApiCallOptions) =>
    apiFetch<Activity[]>(`/api/activity?projectId=${projectId}&limit=${limit}`, { ...opts }),
}

export const adminApi = {
  legacyKeyStatus: (opts?: ApiCallOptions) =>
    apiFetch<LegacyApiKeyStatus>('/api/admin/security/keys', { cache: 'no-store', ...opts }),

  migrateLegacyKeys: (opts?: ApiCallOptions) =>
    apiFetch<LegacyApiKeyMigrationResponse>('/api/admin/security/keys', { method: 'POST', ...opts }),
}

export const seedApi = {
  run: (opts?: ApiCallOptions) =>
    apiFetch<SeedResponse>('/api/seed', { method: 'POST', ...opts }),
}

export const realtimeApi = {
  token: (projectId: string, opts?: ApiCallOptions) =>
    apiFetch<RealtimeTokenResponse>(`/api/realtime/token?projectId=${projectId}`, { cache: 'no-store', ...opts }),
}
