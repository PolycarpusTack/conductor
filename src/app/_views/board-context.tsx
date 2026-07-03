'use client'

import { createContext, useContext } from 'react'
import type { Context, Dispatch, DragEvent, ReactNode, SetStateAction } from 'react'
import type { Task, TaskStatus, TaskPriority, TaskStepSummary, Project, Agent, ProjectListItem } from '@/types/board'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate, TaskTemplate, StepDraft } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'
import type { LiveAgentLogEntry } from '@/types/live-agent'

/**
 * Board contexts (E-3). page.tsx keeps running the four state hooks
 * (useProjectData / useTaskManager / useAgentManager / useWebSocket) exactly
 * as before; BoardProvider only packages their returns into grouped context
 * values so consumers stop re-drilling ~110 props.
 *
 * Grouping rationale:
 * - ProjectData: everything owned by useProjectData (project list/current,
 *   settings collections, API-key panel state, project-create form).
 * - TaskActions: everything owned by useTaskManager (task form, DnD, dialogs).
 * - AgentActions: everything owned by useAgentManager.
 * - UiState: page-level view/dialog routing state + auth surface.
 * - Realtime: low-frequency connection status + notification bump.
 * - LiveAgentLogs: ISOLATED context — it updates on every agent log event,
 *   so keeping it out of the other values means (post E-5 memoization) log
 *   spam only re-renders components that actually subscribe to it.
 *
 * page.tsx memoizes each provider value with useMemo over its parts.
 */

export type ViewType = 'landing' | 'board' | 'runtime' | 'skills' | 'help'
export type SettingsTabType = 'general' | 'agents' | 'api' | 'security' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null

export interface LegacyKeyStatus {
  projectsWithPlaintext: number
  agentsWithPlaintext: number
  totalWithPlaintext: number
}

export interface ViewingTaskSteps {
  id: string
  title: string
  steps: TaskStepSummary[]
}

export interface ProjectDataContextValue {
  // Project list & current project
  projects: ProjectListItem[]
  currentProject: Project | null
  setCurrentProject: Dispatch<SetStateAction<Project | null>>
  loading: boolean
  loadError: string | null
  seedingDemoData: boolean
  // Project settings collections
  projectModes: ProjectMode[]
  setProjectModes: Dispatch<SetStateAction<ProjectMode[]>>
  projectRuntimes: ProjectRuntime[]
  setProjectRuntimes: Dispatch<SetStateAction<ProjectRuntime[]>>
  projectMcpConnections: ProjectMcpConnection[]
  setProjectMcpConnections: Dispatch<SetStateAction<ProjectMcpConnection[]>>
  chainTemplates: ChainTemplate[]
  setChainTemplates: Dispatch<SetStateAction<ChainTemplate[]>>
  taskTemplates: TaskTemplate[]
  setTaskTemplates: Dispatch<SetStateAction<TaskTemplate[]>>
  triggers: IntegrationTrigger[]
  setTriggers: Dispatch<SetStateAction<IntegrationTrigger[]>>
  settingsSyncedProjectId: string | null
  // API-key panel state
  projectApiKey: string | null
  projectApiPreview: string | null
  agentApiKeys: Record<string, string>
  agentApiPreviews: Record<string, string>
  loadingApiKeys: boolean
  rotatingKeyId: string | null
  legacyKeyStatus: LegacyKeyStatus | null
  migratingLegacyKeys: boolean
  copiedKey: string | null
  // Project creation form
  projectDialogOpen: boolean
  setProjectDialogOpen: Dispatch<SetStateAction<boolean>>
  projectName: string
  setProjectName: Dispatch<SetStateAction<string>>
  projectDescription: string
  setProjectDescription: Dispatch<SetStateAction<string>>
  projectColor: string
  setProjectColor: Dispatch<SetStateAction<string>>
  createStarterAgents: boolean
  setCreateStarterAgents: Dispatch<SetStateAction<boolean>>
  // Actions
  fetchProject: (id: string) => Promise<Project | null>
  initializeBoard: () => Promise<void>
  switchProject: (id: string) => Promise<void>
  handleCreateProject: () => Promise<void>
  handleSeedDemoData: () => Promise<void>
  resetProjectForm: () => void
  copyToClipboard: (text: string, key: string) => Promise<void>
  rotateProjectApiKey: () => Promise<void>
  rotateAgentApiKey: (agentId: string) => Promise<void>
  migrateLegacyKeys: () => Promise<void>
  // Derived
  getTasksByStatus: (status: TaskStatus) => Task[]
}

export interface TaskActionsContextValue {
  editingTask: Task | null
  taskDialogOpen: boolean
  setTaskDialogOpen: Dispatch<SetStateAction<boolean>>
  chainDialogOpen: boolean
  setChainDialogOpen: Dispatch<SetStateAction<boolean>>
  viewingTaskSteps: ViewingTaskSteps | null
  setViewingTaskSteps: Dispatch<SetStateAction<ViewingTaskSteps | null>>
  selectedTask: Task | null
  setSelectedTask: Dispatch<SetStateAction<Task | null>>
  mobileColumn: TaskStatus
  setMobileColumn: Dispatch<SetStateAction<TaskStatus>>
  // Task form
  taskTitle: string
  setTaskTitle: Dispatch<SetStateAction<string>>
  taskDescription: string
  setTaskDescription: Dispatch<SetStateAction<string>>
  taskStatus: TaskStatus
  setTaskStatus: Dispatch<SetStateAction<TaskStatus>>
  taskPriority: TaskPriority
  setTaskPriority: Dispatch<SetStateAction<TaskPriority>>
  taskTag: string
  setTaskTag: Dispatch<SetStateAction<string>>
  taskAgentId: string
  setTaskAgentId: Dispatch<SetStateAction<string>>
  taskNotes: string
  setTaskNotes: Dispatch<SetStateAction<string>>
  taskRuntimeOverride: string
  setTaskRuntimeOverride: Dispatch<SetStateAction<string>>
  taskSteps: StepDraft[]
  setTaskSteps: Dispatch<SetStateAction<StepDraft[]>>
  // Actions
  handleSaveTask: () => Promise<void>
  handleCreateChain: () => Promise<void>
  handleDeleteTask: (id: string) => Promise<void>
  handleDragStart: (task: Task) => void
  handleDragOver: (e: DragEvent) => void
  handleDrop: (status: TaskStatus) => Promise<void>
  openEditTaskDialog: (task: Task) => void
  openNewTaskDialog: (status?: TaskStatus) => void
  openNewChainDialog: () => void
  resetTaskForm: () => void
}

export interface AgentActionsContextValue {
  editingAgent: Agent | null
  setEditingAgent: Dispatch<SetStateAction<Agent | null>>
  agentDialogOpen: boolean
  setAgentDialogOpen: Dispatch<SetStateAction<boolean>>
  wizardOpen: boolean
  setWizardOpen: Dispatch<SetStateAction<boolean>>
  expandedAgentStats: string | null
  setExpandedAgentStats: Dispatch<SetStateAction<string | null>>
  openEditAgentDialog: (agent: Agent) => Promise<void>
  resetAgentForm: () => void
  handleDeleteAgent: (id: string) => Promise<void>
}

export interface UiStateContextValue {
  view: ViewType
  setView: Dispatch<SetStateAction<ViewType>>
  sidebarOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  settingsTab: SettingsTabType
  setSettingsTab: Dispatch<SetStateAction<SettingsTabType>>
  currentWorkspaceId: string | null
  setCurrentWorkspaceId: Dispatch<SetStateAction<string | null>>
  authError: string | null
  handleAdminLogout: () => void
}

export interface RealtimeContextValue {
  wsConnected: boolean
  realtimeConfigured: boolean
  notificationVersion: number
}

const ProjectDataContext = createContext<ProjectDataContextValue | null>(null)
const TaskActionsContext = createContext<TaskActionsContextValue | null>(null)
const AgentActionsContext = createContext<AgentActionsContextValue | null>(null)
const UiStateContext = createContext<UiStateContextValue | null>(null)
const RealtimeContext = createContext<RealtimeContextValue | null>(null)
const LiveAgentLogsContext = createContext<LiveAgentLogEntry[] | null>(null)

function useRequiredContext<T>(context: Context<T | null>, hookName: string): T {
  const value = useContext(context)
  if (value === null) {
    throw new Error(`${hookName} must be used within <BoardProvider>`)
  }
  return value
}

export function useProjectDataCtx(): ProjectDataContextValue {
  return useRequiredContext(ProjectDataContext, 'useProjectDataCtx')
}

export function useTaskActions(): TaskActionsContextValue {
  return useRequiredContext(TaskActionsContext, 'useTaskActions')
}

export function useAgentActions(): AgentActionsContextValue {
  return useRequiredContext(AgentActionsContext, 'useAgentActions')
}

export function useUiState(): UiStateContextValue {
  return useRequiredContext(UiStateContext, 'useUiState')
}

export function useRealtime(): RealtimeContextValue {
  return useRequiredContext(RealtimeContext, 'useRealtime')
}

export function useLiveAgentLogs(): LiveAgentLogEntry[] {
  return useRequiredContext(LiveAgentLogsContext, 'useLiveAgentLogs')
}

interface BoardProviderProps {
  projectData: ProjectDataContextValue
  taskActions: TaskActionsContextValue
  agentActions: AgentActionsContextValue
  uiState: UiStateContextValue
  realtime: RealtimeContextValue
  liveAgentLogs: LiveAgentLogEntry[]
  children: ReactNode
}

export function BoardProvider({
  projectData,
  taskActions,
  agentActions,
  uiState,
  realtime,
  liveAgentLogs,
  children,
}: BoardProviderProps) {
  return (
    <ProjectDataContext.Provider value={projectData}>
      <TaskActionsContext.Provider value={taskActions}>
        <AgentActionsContext.Provider value={agentActions}>
          <UiStateContext.Provider value={uiState}>
            <RealtimeContext.Provider value={realtime}>
              {/* liveAgentLogs stays in its own provider so its high-frequency
                  updates never invalidate the values above (groundwork for E-5) */}
              <LiveAgentLogsContext.Provider value={liveAgentLogs}>
                {children}
              </LiveAgentLogsContext.Provider>
            </RealtimeContext.Provider>
          </UiStateContext.Provider>
        </AgentActionsContext.Provider>
      </TaskActionsContext.Provider>
    </ProjectDataContext.Provider>
  )
}
