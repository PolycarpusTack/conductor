'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { useProjectData } from '@/hooks/useProjectData'
import { useTaskManager } from '@/hooks/useTaskManager'
import { useAgentManager } from '@/hooks/useAgentManager'
import { useWebSocket } from '@/hooks/useWebSocket'
import { AuthView } from './AuthView'
import { BoardProvider } from './board-context'
import { viewToPath, viewFromPathname, VIEW_PATHS } from './view-routes'
import { emptyBoardFilter, type BoardFilter } from './use-filtered-tasks'
import { BoardHeader } from '@/components/board-header'
import { BoardSidebar } from '@/components/board-sidebar'
import { TaskDialog } from '@/components/task-dialog'
import { ChainDialog } from '@/components/chain-dialog'
import { ProjectDialog } from '@/components/project-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { AgentCreationModal } from '@/components/agent-creation-modal'
import { AgentWizardModal } from '@/components/agent-wizard-modal'
import { StepOutputViewer } from '@/components/step-output-viewer'
import { TaskDetailDrawer } from '@/components/task-detail-drawer'
import {
  useProjectDataCtx,
  useTaskActions,
  useAgentActions,
  useUiState,
} from './board-context'
import type {
  ViewType,
  SettingsTabType,
  ProjectDataContextValue,
  TaskActionsContextValue,
  AgentActionsContextValue,
  UiStateContextValue,
  RealtimeContextValue,
} from './board-context'
import type { Task, TaskStatus } from '@/types/board'

/**
 * E-1: the persistent client shell for every routed view in the `(board)`
 * route group (/board, /runtime, /skills, /help). It is mounted by
 * app/(board)/layout.tsx, so Next keeps it (and therefore the four state
 * hooks, the WebSocket, and every context value) alive across navigation
 * between those routes — only the page segment below swaps.
 *
 * `view` is no longer component state: it is derived from the pathname, and
 * `setView` is kept in UiStateContext as a thin `router.push` wrapper so all
 * existing call sites (board-header, dialogs, ...) keep working unchanged.
 */
export function BoardShell({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  const router = useRouter()
  const pathname = usePathname()

  const view = viewFromPathname(pathname)
  const viewRef = useRef<ViewType>(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // Compatibility wrapper: setView('runtime') → router.push('/runtime').
  // Supports the functional-updater form against the current derived view.
  const setView = useCallback<Dispatch<SetStateAction<ViewType>>>((action) => {
    const next = typeof action === 'function' ? action(viewRef.current) : action
    router.push(viewToPath(next))
  }, [router])

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabType>(null)
  // D-1: board filter lives in the persistent shell so it survives navigation
  // between the (board) routes, matching the other UiState fields.
  const [boardFilter, setBoardFilter] = useState<BoardFilter>(emptyBoardFilter)
  const clearBoardFilter = useCallback(() => setBoardFilter(emptyBoardFilter), [])

  const {
    isAdminAuthenticated,
    adminConfigured,
    adminPassword, setAdminPassword,
    adminEmail, setAdminEmail,
    usersExist,
    authError,
    authChecking,
    checkAdminSession,
    login,
    logout,
  } = useAdminAuth()

  const {
    projects, setProjects,
    currentProject, setCurrentProject,
    setActivities,
    loading,
    loadError,
    seedingDemoData,
    projectModes, setProjectModes,
    projectRuntimes, setProjectRuntimes,
    projectMcpConnections, setProjectMcpConnections,
    chainTemplates, setChainTemplates,
    taskTemplates, setTaskTemplates,
    triggers, setTriggers,
    settingsSyncedProjectId,
    projectApiKey,
    projectApiPreview,
    agentApiKeys,
    agentApiPreviews,
    loadingApiKeys,
    rotatingKeyId,
    legacyKeyStatus,
    migratingLegacyKeys,
    copiedKey,
    projectDialogOpen, setProjectDialogOpen,
    projectName, setProjectName,
    projectDescription, setProjectDescription,
    projectColor, setProjectColor,
    createStarterAgents, setCreateStarterAgents,
    fetchProject,
    initializeBoard,
    switchProject,
    handleCreateProject,
    handleSeedDemoData,
    resetProjectForm,
    loadApiKeys,
    fetchLegacyKeyStatus,
    rotateProjectApiKey,
    rotateAgentApiKey,
    migrateLegacyKeys,
    copyToClipboard,
  } = useProjectData()

  const {
    editingTask,
    taskDialogOpen, setTaskDialogOpen,
    chainDialogOpen, setChainDialogOpen,
    viewingTaskSteps, setViewingTaskSteps,
    selectedTask, setSelectedTask,
    mobileColumn, setMobileColumn,
    taskTitle, setTaskTitle,
    taskDescription, setTaskDescription,
    taskStatus, setTaskStatus,
    taskPriority, setTaskPriority,
    taskTag, setTaskTag,
    taskAgentId, setTaskAgentId,
    taskNotes, setTaskNotes,
    taskRuntimeOverride, setTaskRuntimeOverride,
    taskDueDate, setTaskDueDate,
    taskSteps, setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
    bulkMoveTasks,
    bulkArchiveTasks,
    bulkDeleteTasks,
    openEditTaskDialog,
    openNewTaskDialog,
    openNewChainDialog,
    resetTaskForm,
  } = useTaskManager({ currentProject, setCurrentProject })

  const {
    editingAgent, setEditingAgent,
    agentDialogOpen, setAgentDialogOpen,
    wizardOpen, setWizardOpen,
    expandedAgentStats, setExpandedAgentStats,
    openEditAgentDialog,
    resetAgentForm,
    handleDeleteAgent,
  } = useAgentManager({ setCurrentProject })

  // useWebSocket only connects while `view === 'board'`, so navigating to
  // /runtime, /skills, or /help disconnects the socket and returning to
  // /board reconnects it — identical to the pre-route SPA behaviour.
  const { wsConnected, realtimeConfigured, liveAgentLogs, notificationVersion } = useWebSocket({
    currentProject,
    isAdminAuthenticated,
    view,
    fetchProject,
    setCurrentProject,
    setActivities,
    toast,
  })

  // Board init (auth check + data load) runs once per shell mount. Because
  // the shell is a layout, in-app navigation between the (board) routes does
  // NOT re-run it — project state simply persists. A hard load of any of the
  // four routes runs it, so /runtime and /skills are auth-gated too.
  useEffect(() => {
    const init = async () => {
      const authenticated = await checkAdminSession()
      if (authenticated) await initializeBoard()
    }
    init()
  }, [checkAdminSession, initializeBoard])

  // Warm the sibling routes so header navigation feels like the old
  // in-memory view switch. /help especially: its content is server-rendered.
  useEffect(() => {
    for (const path of [VIEW_PATHS.board, VIEW_PATHS.runtime, VIEW_PATHS.skills, VIEW_PATHS.help]) {
      if (path !== pathname) router.prefetch(path)
    }
  }, [router, pathname])

  useEffect(() => {
    if (settingsTab === 'api' && currentProject) {
      loadApiKeys(currentProject)
      fetchLegacyKeyStatus()
    }
  }, [currentProject, fetchLegacyKeyStatus, loadApiKeys, settingsTab])

  // '?' toggles the help route from anywhere in the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      router.push(viewRef.current === 'help' ? VIEW_PATHS.board : VIEW_PATHS.help)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  const handleAdminLogin = useCallback(async () => {
    const result = await login(adminPassword, adminEmail)
    if (!result.ok) return
    if (result.bootstrapped) {
      toast({
        title: 'Owner account created',
        description: `Sign in from now on as ${result.bootstrapped} with the same password. Manage users in Settings → Security.`,
      })
    }
    await initializeBoard()
  }, [adminPassword, adminEmail, initializeBoard, login, toast])

  const handleAdminLogout = useCallback(async () => {
    await logout()
    setCurrentProject(null)
    setProjects([])
    setActivities([])
    setSettingsTab(null)
  }, [logout, setActivities, setCurrentProject, setProjects])

  const getTasksByStatus = useCallback(
    (status: TaskStatus): Task[] =>
      currentProject?.tasks.filter(t => t.status === status).sort((a, b) => a.order - b.order) ?? [],
    [currentProject],
  )

  // E-3: grouped context values. Each is memoized over its parts so a change
  // in one group never invalidates the others' identity.
  const projectData = useMemo<ProjectDataContextValue>(() => ({
    projects,
    currentProject, setCurrentProject,
    loading,
    loadError,
    seedingDemoData,
    projectModes, setProjectModes,
    projectRuntimes, setProjectRuntimes,
    projectMcpConnections, setProjectMcpConnections,
    chainTemplates, setChainTemplates,
    taskTemplates, setTaskTemplates,
    triggers, setTriggers,
    settingsSyncedProjectId,
    projectApiKey,
    projectApiPreview,
    agentApiKeys,
    agentApiPreviews,
    loadingApiKeys,
    rotatingKeyId,
    legacyKeyStatus,
    migratingLegacyKeys,
    copiedKey,
    projectDialogOpen, setProjectDialogOpen,
    projectName, setProjectName,
    projectDescription, setProjectDescription,
    projectColor, setProjectColor,
    createStarterAgents, setCreateStarterAgents,
    fetchProject,
    initializeBoard,
    switchProject,
    handleCreateProject,
    handleSeedDemoData,
    resetProjectForm,
    copyToClipboard,
    rotateProjectApiKey,
    rotateAgentApiKey,
    migrateLegacyKeys,
    getTasksByStatus,
  }), [
    projects, currentProject, setCurrentProject, loading, loadError, seedingDemoData,
    projectModes, setProjectModes, projectRuntimes, setProjectRuntimes,
    projectMcpConnections, setProjectMcpConnections, chainTemplates, setChainTemplates,
    taskTemplates, setTaskTemplates, triggers, setTriggers, settingsSyncedProjectId,
    projectApiKey, projectApiPreview, agentApiKeys, agentApiPreviews, loadingApiKeys,
    rotatingKeyId, legacyKeyStatus, migratingLegacyKeys, copiedKey,
    projectDialogOpen, setProjectDialogOpen, projectName, setProjectName,
    projectDescription, setProjectDescription, projectColor, setProjectColor,
    createStarterAgents, setCreateStarterAgents,
    fetchProject, initializeBoard, switchProject, handleCreateProject,
    handleSeedDemoData, resetProjectForm, copyToClipboard, rotateProjectApiKey,
    rotateAgentApiKey, migrateLegacyKeys, getTasksByStatus,
  ])

  const taskActions = useMemo<TaskActionsContextValue>(() => ({
    editingTask,
    taskDialogOpen, setTaskDialogOpen,
    chainDialogOpen, setChainDialogOpen,
    viewingTaskSteps, setViewingTaskSteps,
    selectedTask, setSelectedTask,
    mobileColumn, setMobileColumn,
    taskTitle, setTaskTitle,
    taskDescription, setTaskDescription,
    taskStatus, setTaskStatus,
    taskPriority, setTaskPriority,
    taskTag, setTaskTag,
    taskAgentId, setTaskAgentId,
    taskNotes, setTaskNotes,
    taskRuntimeOverride, setTaskRuntimeOverride,
    taskDueDate, setTaskDueDate,
    taskSteps, setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
    bulkMoveTasks,
    bulkArchiveTasks,
    bulkDeleteTasks,
    openEditTaskDialog,
    openNewTaskDialog,
    openNewChainDialog,
    resetTaskForm,
  }), [
    editingTask, taskDialogOpen, setTaskDialogOpen, chainDialogOpen, setChainDialogOpen,
    viewingTaskSteps, setViewingTaskSteps, selectedTask, setSelectedTask,
    mobileColumn, setMobileColumn, taskTitle, setTaskTitle, taskDescription, setTaskDescription,
    taskStatus, setTaskStatus, taskPriority, setTaskPriority, taskTag, setTaskTag,
    taskAgentId, setTaskAgentId, taskNotes, setTaskNotes,
    taskRuntimeOverride, setTaskRuntimeOverride, taskDueDate, setTaskDueDate, taskSteps, setTaskSteps,
    handleSaveTask, handleCreateChain, handleDeleteTask, handleDragStart,
    handleDragOver, handleDrop, bulkMoveTasks, bulkArchiveTasks, bulkDeleteTasks,
    openEditTaskDialog, openNewTaskDialog,
    openNewChainDialog, resetTaskForm,
  ])

  const agentActions = useMemo<AgentActionsContextValue>(() => ({
    editingAgent, setEditingAgent,
    agentDialogOpen, setAgentDialogOpen,
    wizardOpen, setWizardOpen,
    expandedAgentStats, setExpandedAgentStats,
    openEditAgentDialog,
    resetAgentForm,
    handleDeleteAgent,
  }), [
    editingAgent, setEditingAgent, agentDialogOpen, setAgentDialogOpen,
    wizardOpen, setWizardOpen, expandedAgentStats, setExpandedAgentStats,
    openEditAgentDialog, resetAgentForm, handleDeleteAgent,
  ])

  const uiState = useMemo<UiStateContextValue>(() => ({
    view, setView,
    sidebarOpen, setSidebarOpen,
    settingsTab, setSettingsTab,
    currentWorkspaceId, setCurrentWorkspaceId,
    authError,
    handleAdminLogout,
    boardFilter, setBoardFilter, clearBoardFilter,
  }), [
    view, setView, sidebarOpen, settingsTab, currentWorkspaceId, authError, handleAdminLogout,
    boardFilter, clearBoardFilter,
  ])

  const realtime = useMemo<RealtimeContextValue>(() => ({
    wsConnected,
    realtimeConfigured,
    notificationVersion,
  }), [wsConnected, realtimeConfigured, notificationVersion])

  if (authChecking || !isAdminAuthenticated) {
    return (
      <AuthView
        authChecking={authChecking}
        adminPassword={adminPassword}
        setAdminPassword={setAdminPassword}
        adminEmail={adminEmail}
        setAdminEmail={setAdminEmail}
        usersExist={usersExist}
        adminConfigured={adminConfigured}
        authError={authError}
        loading={loading}
        handleAdminLogin={handleAdminLogin}
        setView={(v) => router.push(viewToPath(v))}
      />
    )
  }

  return (
    <BoardProvider
      projectData={projectData}
      taskActions={taskActions}
      agentActions={agentActions}
      uiState={uiState}
      realtime={realtime}
      liveAgentLogs={liveAgentLogs}
    >
      <BoardChrome>{children}</BoardChrome>
    </BoardProvider>
  )
}

/**
 * The chrome shared by every routed view: fixed header, sidebar, and the
 * dialogs/drawers that page.tsx used to render once for the whole SPA.
 * Rendering it here (inside the layout) keeps header state, open dialogs,
 * and the task drawer alive across route navigation.
 */
function BoardChrome({ children }: { children: ReactNode }) {
  const {
    currentProject, setCurrentProject,
    projectModes, projectRuntimes, projectMcpConnections,
    fetchProject,
  } = useProjectDataCtx()
  const {
    viewingTaskSteps, setViewingTaskSteps,
    selectedTask, setSelectedTask,
    openEditTaskDialog,
  } = useTaskActions()
  const {
    editingAgent, setEditingAgent,
    agentDialogOpen, setAgentDialogOpen,
    wizardOpen, setWizardOpen,
  } = useAgentActions()
  const { authError } = useUiState()

  return (
    <div className="min-h-screen bg-background dark">
      <BoardHeader />

      <main className="pt-14 flex">
        <BoardSidebar />

        {/* Routed view canvas */}
        <div className="flex-1 overflow-hidden">
          {authError && (
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {authError}
            </div>
          )}
          {children}
        </div>
      </main>

      <TaskDialog />

      <ChainDialog />

      <ProjectDialog />

      <SettingsDialog />

      <AgentCreationModal
        open={agentDialogOpen}
        onOpenChange={(open) => { setAgentDialogOpen(open); if (!open) setEditingAgent(null) }}
        projectId={currentProject?.id || ''}
        editingAgent={editingAgent}
        modes={projectModes}
        runtimes={projectRuntimes}
        mcpConnections={projectMcpConnections}
        onSave={(agent) => {
          if (editingAgent) {
            setCurrentProject(prev => prev ? { ...prev, agents: prev.agents.map(a => a.id === agent.id ? agent : a) } : null)
          } else {
            setCurrentProject(prev => prev ? { ...prev, agents: [...prev.agents, agent] } : null)
          }
          setAgentDialogOpen(false)
          setEditingAgent(null)
        }}
      />

      {viewingTaskSteps && (
        <StepOutputViewer
          taskId={viewingTaskSteps.id}
          taskTitle={viewingTaskSteps.title}
          steps={viewingTaskSteps.steps}
          onClose={() => setViewingTaskSteps(null)}
          onRefresh={() => {
            if (currentProject) fetchProject(currentProject.id).then(setCurrentProject)
          }}
        />
      )}

      {selectedTask && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={() => setSelectedTask(null)} />
          <TaskDetailDrawer
            task={selectedTask}
            agents={currentProject?.agents ?? []}
            onClose={() => setSelectedTask(null)}
            onEdit={() => { openEditTaskDialog(selectedTask); setSelectedTask(null) }}
            onRefresh={() => {
              if (currentProject) fetchProject(currentProject.id).then(p => {
                setCurrentProject(p)
                if (p) {
                  const updated = p.tasks?.find((t) => t.id === selectedTask.id)
                  if (updated) setSelectedTask(updated)
                }
              })
            }}
          />
        </>
      )}

      <AgentWizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        projectId={currentProject?.id ?? ''}
        onAgentCreated={() => { setWizardOpen(false); if (currentProject) fetchProject(currentProject.id).then(setCurrentProject) }}
      />
    </div>
  )
}
