'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useAdminAuth } from '@/hooks/useAdminAuth'
import { useProjectData } from '@/hooks/useProjectData'
import { useTaskManager } from '@/hooks/useTaskManager'
import { useAgentManager } from '@/hooks/useAgentManager'
import { useWebSocket } from '@/hooks/useWebSocket'
import { LandingView } from './_views/LandingView'
import { AuthView } from './_views/AuthView'
import { BoardView } from './_views/BoardView'
import type { TaskStatus, TaskPriority } from '@/types/board'

const statusColumns: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'BACKLOG', label: 'Backlog', color: 'text-3' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'text-[var(--op-blue)]' },
  { id: 'WAITING', label: 'Waiting', color: 'text-[var(--op-amber)]' },
  { id: 'REVIEW', label: 'Review', color: 'text-[var(--op-purple)]' },
  { id: 'DONE', label: 'Done', color: 'text-[var(--op-teal)]' },
]

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-[var(--text-dim)]',
  MEDIUM: 'bg-[var(--op-amber)]',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-[var(--op-red)]',
}

const tagColors: Record<string, string> = {
  research: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
  docs: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)] border border-[var(--op-blue-dim)]',
  backend: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]',
  frontend: 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
  devops: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  copy: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  design: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
}

const showDemoSeed = process.env.NODE_ENV !== 'production'

export default function Home() {
  const { toast } = useToast()

  const [view, setView] = useState<'landing' | 'board' | 'runtime' | 'skills' | 'help'>('landing')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'agents' | 'api' | 'security' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null>(null)

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

  const { wsConnected, realtimeConfigured, liveAgentLogs } = useWebSocket({
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

  const getTasksByStatus = (status: TaskStatus) =>
    currentProject?.tasks.filter(t => t.status === status).sort((a, b) => a.order - b.order) ?? []

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
    <BoardView
      authError={authError}
      handleAdminLogout={handleAdminLogout}
      projects={projects}
      currentProject={currentProject}
      setCurrentProject={setCurrentProject}
      loading={loading}
      loadError={loadError}
      seedingDemoData={seedingDemoData}
      projectModes={projectModes}
      setProjectModes={setProjectModes}
      projectRuntimes={projectRuntimes}
      setProjectRuntimes={setProjectRuntimes}
      projectMcpConnections={projectMcpConnections}
      setProjectMcpConnections={setProjectMcpConnections}
      chainTemplates={chainTemplates}
      setChainTemplates={setChainTemplates}
      taskTemplates={taskTemplates}
      setTaskTemplates={setTaskTemplates}
      triggers={triggers}
      setTriggers={setTriggers}
      settingsSyncedProjectId={settingsSyncedProjectId}
      projectApiKey={projectApiKey}
      projectApiPreview={projectApiPreview}
      agentApiKeys={agentApiKeys}
      agentApiPreviews={agentApiPreviews}
      loadingApiKeys={loadingApiKeys}
      rotatingKeyId={rotatingKeyId}
      legacyKeyStatus={legacyKeyStatus}
      migratingLegacyKeys={migratingLegacyKeys}
      copiedKey={copiedKey}
      projectDialogOpen={projectDialogOpen}
      setProjectDialogOpen={setProjectDialogOpen}
      projectName={projectName}
      setProjectName={setProjectName}
      projectDescription={projectDescription}
      setProjectDescription={setProjectDescription}
      projectColor={projectColor}
      setProjectColor={setProjectColor}
      createStarterAgents={createStarterAgents}
      setCreateStarterAgents={setCreateStarterAgents}
      fetchProject={fetchProject}
      initializeBoard={initializeBoard}
      switchProject={switchProject}
      handleCreateProject={handleCreateProject}
      handleSeedDemoData={handleSeedDemoData}
      resetProjectForm={resetProjectForm}
      copyToClipboard={copyToClipboard}
      rotateProjectApiKey={rotateProjectApiKey}
      rotateAgentApiKey={rotateAgentApiKey}
      migrateLegacyKeys={migrateLegacyKeys}
      editingTask={editingTask}
      taskDialogOpen={taskDialogOpen}
      setTaskDialogOpen={setTaskDialogOpen}
      chainDialogOpen={chainDialogOpen}
      setChainDialogOpen={setChainDialogOpen}
      viewingTaskSteps={viewingTaskSteps}
      setViewingTaskSteps={setViewingTaskSteps}
      selectedTask={selectedTask}
      setSelectedTask={setSelectedTask}
      mobileColumn={mobileColumn}
      setMobileColumn={setMobileColumn}
      taskTitle={taskTitle}
      setTaskTitle={setTaskTitle}
      taskDescription={taskDescription}
      setTaskDescription={setTaskDescription}
      taskStatus={taskStatus}
      setTaskStatus={setTaskStatus}
      taskPriority={taskPriority}
      setTaskPriority={setTaskPriority}
      taskTag={taskTag}
      setTaskTag={setTaskTag}
      taskAgentId={taskAgentId}
      setTaskAgentId={setTaskAgentId}
      taskNotes={taskNotes}
      setTaskNotes={setTaskNotes}
      taskRuntimeOverride={taskRuntimeOverride}
      setTaskRuntimeOverride={setTaskRuntimeOverride}
      taskSteps={taskSteps}
      setTaskSteps={setTaskSteps}
      handleSaveTask={handleSaveTask}
      handleCreateChain={handleCreateChain}
      handleDeleteTask={handleDeleteTask}
      handleDragStart={handleDragStart}
      handleDragOver={handleDragOver}
      handleDrop={handleDrop}
      openEditTaskDialog={openEditTaskDialog}
      openNewTaskDialog={openNewTaskDialog}
      openNewChainDialog={openNewChainDialog}
      resetTaskForm={resetTaskForm}
      editingAgent={editingAgent}
      setEditingAgent={setEditingAgent}
      agentDialogOpen={agentDialogOpen}
      setAgentDialogOpen={setAgentDialogOpen}
      wizardOpen={wizardOpen}
      setWizardOpen={setWizardOpen}
      expandedAgentStats={expandedAgentStats}
      setExpandedAgentStats={setExpandedAgentStats}
      openEditAgentDialog={openEditAgentDialog}
      resetAgentForm={resetAgentForm}
      handleDeleteAgent={handleDeleteAgent}
      wsConnected={wsConnected}
      realtimeConfigured={realtimeConfigured}
      liveAgentLogs={liveAgentLogs}
      view={view}
      setView={setView}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
      settingsTab={settingsTab}
      setSettingsTab={setSettingsTab}
      currentWorkspaceId={currentWorkspaceId}
      setCurrentWorkspaceId={setCurrentWorkspaceId}
      getTasksByStatus={getTasksByStatus}
      statusColumns={statusColumns}
      priorityColors={priorityColors}
      tagColors={tagColors}
      showDemoSeed={showDemoSeed}
    />
  )
}
