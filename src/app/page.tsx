'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { useProjectData } from '@/hooks/useProjectData'
import { useTaskManager } from '@/hooks/useTaskManager'
import { useAgentManager } from '@/hooks/useAgentManager'
import { useWebSocket } from '@/hooks/useWebSocket'
import { LandingView } from './_views/LandingView'
import { AuthView } from './_views/AuthView'
import { BoardView } from './_views/BoardView'
import { BoardProvider } from './_views/board-context'
import type {
  ViewType,
  SettingsTabType,
  ProjectDataContextValue,
  TaskActionsContextValue,
  AgentActionsContextValue,
  UiStateContextValue,
  RealtimeContextValue,
} from './_views/board-context'
import type { Task, TaskStatus } from '@/types/board'

export default function Home() {
  const { toast } = useToast()

  const [view, setView] = useState<ViewType>('landing')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTabType>(null)

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
    taskSteps, setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
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

  const { wsConnected, realtimeConfigured, liveAgentLogs, notificationVersion } = useWebSocket({
    currentProject,
    isAdminAuthenticated,
    view,
    fetchProject,
    setCurrentProject,
    setActivities,
    toast,
  })

  useEffect(() => {
    if (view === 'board') {
      const init = async () => {
        const authenticated = await checkAdminSession()
        if (authenticated) await initializeBoard()
      }
      init()
    }
  }, [checkAdminSession, initializeBoard, view])

  useEffect(() => {
    if (settingsTab === 'api' && currentProject) {
      loadApiKeys(currentProject)
      fetchLegacyKeyStatus()
    }
  }, [currentProject, fetchLegacyKeyStatus, loadApiKeys, settingsTab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setView((v) => (v === 'help' ? 'board' : 'help'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    taskSteps, setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
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
    taskRuntimeOverride, setTaskRuntimeOverride, taskSteps, setTaskSteps,
    handleSaveTask, handleCreateChain, handleDeleteTask, handleDragStart,
    handleDragOver, handleDrop, openEditTaskDialog, openNewTaskDialog,
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
  }), [
    view, sidebarOpen, settingsTab, currentWorkspaceId, authError, handleAdminLogout,
  ])

  const realtime = useMemo<RealtimeContextValue>(() => ({
    wsConnected,
    realtimeConfigured,
    notificationVersion,
  }), [wsConnected, realtimeConfigured, notificationVersion])

  if (view === 'landing') {
    return <LandingView setView={setView} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
  }

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
        setView={setView}
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
      <BoardView />
    </BoardProvider>
  )
}
