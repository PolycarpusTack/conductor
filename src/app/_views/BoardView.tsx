'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FolderPlus,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { RuntimeDashboard } from '@/components/runtime-dashboard'
import { SkillsPage } from '@/components/skills-page'
import { AgentCreationModal } from '@/components/agent-creation-modal'
import { AgentWizardModal } from '@/components/agent-wizard-modal'
import { StepOutputViewer } from '@/components/step-output-viewer'
import { TaskDetailDrawer } from '@/components/task-detail-drawer'
import { HelpPage } from '@/components/help-page'
import { BoardHeader } from '@/components/board-header'
import { BoardTaskCard } from '@/components/board-task-card'
import { BoardSidebar } from '@/components/board-sidebar'
import { TaskDialog } from '@/components/task-dialog'
import { ChainDialog } from '@/components/chain-dialog'
import { ProjectDialog } from '@/components/project-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import type { Task, TaskStatus, TaskPriority, TaskStepSummary, Project, Agent, ProjectListItem } from '@/types/board'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate, StepDraft } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'
import type { LiveAgentLogEntry } from '@/types/live-agent'

export type ViewType = 'landing' | 'board' | 'runtime' | 'skills' | 'help'
export type SettingsTabType = 'general' | 'agents' | 'api' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null

interface BoardViewProps {
  // Auth
  authError: string | null
  handleAdminLogout: () => void
  // Project data
  projects: ProjectListItem[]
  currentProject: Project | null
  setCurrentProject: Dispatch<SetStateAction<Project | null>>
  loading: boolean
  seedingDemoData: boolean
  projectModes: ProjectMode[]
  setProjectModes: Dispatch<SetStateAction<ProjectMode[]>>
  projectRuntimes: ProjectRuntime[]
  setProjectRuntimes: Dispatch<SetStateAction<ProjectRuntime[]>>
  projectMcpConnections: ProjectMcpConnection[]
  setProjectMcpConnections: Dispatch<SetStateAction<ProjectMcpConnection[]>>
  chainTemplates: ChainTemplate[]
  setChainTemplates: Dispatch<SetStateAction<ChainTemplate[]>>
  triggers: IntegrationTrigger[]
  setTriggers: Dispatch<SetStateAction<IntegrationTrigger[]>>
  projectApiKey: string | null
  projectApiPreview: string | null
  agentApiKeys: Record<string, string>
  agentApiPreviews: Record<string, string>
  loadingApiKeys: boolean
  rotatingKeyId: string | null
  legacyKeyStatus: { projectsWithPlaintext: number; agentsWithPlaintext: number; totalWithPlaintext: number } | null
  migratingLegacyKeys: boolean
  copiedKey: string | null
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
  fetchProject: (id: string) => Promise<Project | null>
  switchProject: (id: string) => Promise<void>
  handleCreateProject: () => Promise<void>
  handleSeedDemoData: () => Promise<void>
  resetProjectForm: () => void
  copyToClipboard: (text: string, key: string) => Promise<void>
  rotateProjectApiKey: () => Promise<void>
  rotateAgentApiKey: (agentId: string) => Promise<void>
  migrateLegacyKeys: () => Promise<void>
  // Task manager
  editingTask: Task | null
  taskDialogOpen: boolean
  setTaskDialogOpen: Dispatch<SetStateAction<boolean>>
  chainDialogOpen: boolean
  setChainDialogOpen: Dispatch<SetStateAction<boolean>>
  viewingTaskSteps: { id: string; title: string; steps: TaskStepSummary[] } | null
  setViewingTaskSteps: Dispatch<SetStateAction<{ id: string; title: string; steps: TaskStepSummary[] } | null>>
  selectedTask: Task | null
  setSelectedTask: Dispatch<SetStateAction<Task | null>>
  mobileColumn: TaskStatus
  setMobileColumn: Dispatch<SetStateAction<TaskStatus>>
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
  handleSaveTask: () => Promise<void>
  handleCreateChain: () => Promise<void>
  handleDeleteTask: (id: string) => Promise<void>
  handleDragStart: (task: Task) => void
  handleDragOver: (e: React.DragEvent) => void
  handleDrop: (status: TaskStatus) => Promise<void>
  openEditTaskDialog: (task: Task) => void
  openNewTaskDialog: (status?: TaskStatus) => void
  openNewChainDialog: () => void
  resetTaskForm: () => void
  // Agent manager
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
  // WebSocket
  wsConnected: boolean
  realtimeConfigured: boolean
  liveAgentLogs: LiveAgentLogEntry[]
  // Page-level
  view: ViewType
  setView: (v: ViewType) => void
  sidebarOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  settingsTab: SettingsTabType
  setSettingsTab: (tab: SettingsTabType) => void
  currentWorkspaceId: string | null
  setCurrentWorkspaceId: (id: string | null) => void
  // Utilities
  getTasksByStatus: (status: TaskStatus) => Task[]
  statusColumns: { id: TaskStatus; label: string; color: string }[]
  priorityColors: Record<TaskPriority, string>
  tagColors: Record<string, string>
  showDemoSeed: boolean
}

export function BoardView({
  authError, handleAdminLogout,
  projects, currentProject, setCurrentProject, loading, seedingDemoData,
  projectModes, setProjectModes, projectRuntimes, setProjectRuntimes,
  projectMcpConnections, setProjectMcpConnections, chainTemplates, setChainTemplates,
  triggers, setTriggers,
  projectApiKey, projectApiPreview, agentApiKeys, agentApiPreviews,
  loadingApiKeys, rotatingKeyId, legacyKeyStatus, migratingLegacyKeys, copiedKey,
  projectDialogOpen, setProjectDialogOpen, projectName, setProjectName,
  projectDescription, setProjectDescription, projectColor, setProjectColor,
  createStarterAgents, setCreateStarterAgents,
  fetchProject, switchProject, handleCreateProject, handleSeedDemoData, resetProjectForm,
  copyToClipboard, rotateProjectApiKey, rotateAgentApiKey, migrateLegacyKeys,
  editingTask, taskDialogOpen, setTaskDialogOpen, chainDialogOpen, setChainDialogOpen,
  viewingTaskSteps, setViewingTaskSteps, selectedTask, setSelectedTask,
  mobileColumn, setMobileColumn,
  taskTitle, setTaskTitle, taskDescription, setTaskDescription,
  taskStatus, setTaskStatus, taskPriority, setTaskPriority,
  taskTag, setTaskTag, taskAgentId, setTaskAgentId,
  taskNotes, setTaskNotes, taskRuntimeOverride, setTaskRuntimeOverride,
  taskSteps, setTaskSteps,
  handleSaveTask, handleCreateChain, handleDeleteTask,
  handleDragStart, handleDragOver, handleDrop,
  openEditTaskDialog, openNewTaskDialog, openNewChainDialog, resetTaskForm,
  editingAgent, setEditingAgent, agentDialogOpen, setAgentDialogOpen,
  wizardOpen, setWizardOpen, expandedAgentStats, setExpandedAgentStats,
  openEditAgentDialog, resetAgentForm, handleDeleteAgent,
  wsConnected, realtimeConfigured, liveAgentLogs,
  view, setView, sidebarOpen, setSidebarOpen,
  settingsTab, setSettingsTab, currentWorkspaceId, setCurrentWorkspaceId,
  getTasksByStatus, statusColumns, priorityColors, tagColors, showDemoSeed,
}: BoardViewProps) {
  return (
    <div className="min-h-screen bg-background dark">
      <BoardHeader
        view={view}
        setView={setView}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        projects={projects}
        currentProject={currentProject}
        switchProject={switchProject}
        wsConnected={wsConnected}
        realtimeConfigured={realtimeConfigured}
        setProjectDialogOpen={setProjectDialogOpen}
        setSettingsTab={setSettingsTab}
        handleAdminLogout={handleAdminLogout}
        currentWorkspaceId={currentWorkspaceId}
        setCurrentWorkspaceId={setCurrentWorkspaceId}
      />

      <main className="pt-14 flex">
        <BoardSidebar
          projects={projects}
          currentProject={currentProject}
          switchProject={switchProject}
          openEditAgentDialog={openEditAgentDialog}
          setEditingAgent={setEditingAgent}
          setAgentDialogOpen={setAgentDialogOpen}
          setWizardOpen={setWizardOpen}
          openNewChainDialog={openNewChainDialog}
        />

        {/* Board canvas */}
        <div className="flex-1 overflow-hidden">
          {authError && (
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {authError}
            </div>
          )}
          {view === 'runtime' ? (
            <div className="p-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Runtime Dashboard</h2>
                <Button variant="outline" size="sm" onClick={() => setView('board')}>Back to Board</Button>
              </div>
              <RuntimeDashboard liveAgentLogs={liveAgentLogs} />
            </div>
          ) : view === 'skills' ? (
            <div className="p-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div />
                <Button variant="outline" size="sm" onClick={() => setView('board')}>Back to Board</Button>
              </div>
              <SkillsPage workspaceId={currentWorkspaceId} />
            </div>
          ) : view === 'help' ? (
            <HelpPage onBack={() => setView('board')} />
          ) : loading ? (
            <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
              <div className="flex flex-col items-center gap-3">
                <Sparkles className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
                <span className="text-sm text-muted-foreground">Loading board...</span>
              </div>
            </div>
          ) : !currentProject ? (
            <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
              <div className="max-w-md rounded-2xl border border-border/30 bg-card p-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40">
                  <FolderPlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold">No projects yet</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start with a real project, or load demo data explicitly for a local evaluation environment.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setProjectDialogOpen(true)}>Create Project</Button>
                  {showDemoSeed && (
                    <Button variant="outline" onClick={handleSeedDemoData} disabled={seedingDemoData}>
                      <RefreshCw className={`mr-2 h-4 w-4 ${seedingDemoData ? 'animate-spin' : ''}`} />
                      Load Demo Data
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-3.5rem)] custom-scrollbar">
              <div className="p-4">
                {/* Mobile column tabs */}
                <div className="flex xs:hidden gap-1 mb-3 overflow-x-auto pb-1">
                  {statusColumns.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => setMobileColumn(col.id as TaskStatus)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        mobileColumn === col.id
                          ? 'bg-card border border-border/30 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {col.label}
                      <span className="ml-1.5 text-[10px] opacity-60">{getTasksByStatus(col.id).length}</span>
                    </button>
                  ))}
                </div>

                {/* Desktop / tablet board grid */}
                <div className="hidden xs:flex md:grid md:grid-cols-5 xs:flex-nowrap gap-4 overflow-x-auto">
                  {statusColumns.map((column) => {
                    const tasks = getTasksByStatus(column.id)
                    return (
                      <div
                        key={column.id}
                        className="min-w-[280px] md:min-w-0"
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(column.id)}
                      >
                        <div className="mb-3 flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-medium uppercase tracking-wider ${column.color}`}>
                              {column.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/30">{tasks.length}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 hover:opacity-100 group-hover:opacity-50 transition-opacity"
                            onClick={() => openNewTaskDialog(column.id)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>

                        <div className="flex flex-col gap-2">
                          {tasks.map((task) => (
                            <BoardTaskCard
                              key={task.id}
                              task={task}
                              priorityColors={priorityColors}
                              tagColors={tagColors}
                              onOpen={setSelectedTask}
                              onViewSteps={setViewingTaskSteps}
                              draggable
                              onDragStart={handleDragStart}
                              onEdit={openEditTaskDialog}
                              onDelete={handleDeleteTask}
                              liveAgentLogs={liveAgentLogs}
                            />
                          ))}

                          <button
                            onClick={() => openNewTaskDialog(column.id)}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add task
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Mobile: single column view */}
                <div className="xs:hidden">
                  {statusColumns
                    .filter((col) => col.id === mobileColumn)
                    .map((column) => {
                      const columnTasks = getTasksByStatus(column.id)
                      return (
                        <div key={column.id} className="space-y-2">
                          <div className={`text-sm font-medium ${column.color} mb-2`}>
                            {column.label}
                            <span className="ml-2 text-xs opacity-60">{columnTasks.length}</span>
                          </div>
                          {columnTasks.map((task) => (
                            <BoardTaskCard
                              key={task.id}
                              task={task}
                              priorityColors={priorityColors}
                              tagColors={tagColors}
                              onOpen={setSelectedTask}
                              onViewSteps={setViewingTaskSteps}
                            />
                          ))}

                          <button
                            onClick={() => openNewTaskDialog(column.id)}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70 transition-colors w-full"
                          >
                            <Plus className="h-3 w-3" />
                            Add task
                          </button>

                          {columnTasks.length === 0 && (
                            <div className="text-xs text-muted-foreground/40 text-center py-8">No tasks</div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </main>

      <TaskDialog
        taskDialogOpen={taskDialogOpen}
        setTaskDialogOpen={setTaskDialogOpen}
        editingTask={editingTask}
        taskTitle={taskTitle} setTaskTitle={setTaskTitle}
        taskDescription={taskDescription} setTaskDescription={setTaskDescription}
        taskStatus={taskStatus} setTaskStatus={setTaskStatus}
        taskPriority={taskPriority} setTaskPriority={setTaskPriority}
        taskTag={taskTag} setTaskTag={setTaskTag}
        taskAgentId={taskAgentId} setTaskAgentId={setTaskAgentId}
        taskNotes={taskNotes} setTaskNotes={setTaskNotes}
        taskRuntimeOverride={taskRuntimeOverride} setTaskRuntimeOverride={setTaskRuntimeOverride}
        taskSteps={taskSteps} setTaskSteps={setTaskSteps}
        handleSaveTask={handleSaveTask}
        resetTaskForm={resetTaskForm}
        currentProject={currentProject}
        projectModes={projectModes}
        chainTemplates={chainTemplates}
        statusColumns={statusColumns}
      />

      <ChainDialog
        chainDialogOpen={chainDialogOpen}
        setChainDialogOpen={setChainDialogOpen}
        taskTitle={taskTitle} setTaskTitle={setTaskTitle}
        taskDescription={taskDescription} setTaskDescription={setTaskDescription}
        taskPriority={taskPriority} setTaskPriority={setTaskPriority}
        taskSteps={taskSteps} setTaskSteps={setTaskSteps}
        handleCreateChain={handleCreateChain}
        resetTaskForm={resetTaskForm}
        currentProject={currentProject}
        projectModes={projectModes}
        chainTemplates={chainTemplates}
      />

      <ProjectDialog
        projectDialogOpen={projectDialogOpen}
        setProjectDialogOpen={setProjectDialogOpen}
        projectName={projectName} setProjectName={setProjectName}
        projectDescription={projectDescription} setProjectDescription={setProjectDescription}
        projectColor={projectColor} setProjectColor={setProjectColor}
        createStarterAgents={createStarterAgents} setCreateStarterAgents={setCreateStarterAgents}
        handleCreateProject={handleCreateProject}
        resetProjectForm={resetProjectForm}
      />

      <SettingsDialog
        settingsTab={settingsTab}
        setSettingsTab={setSettingsTab}
        currentProject={currentProject}
        getTasksByStatus={getTasksByStatus}
        statusColumns={statusColumns}
        projectModes={projectModes} setProjectModes={setProjectModes}
        projectRuntimes={projectRuntimes} setProjectRuntimes={setProjectRuntimes}
        projectMcpConnections={projectMcpConnections} setProjectMcpConnections={setProjectMcpConnections}
        chainTemplates={chainTemplates} setChainTemplates={setChainTemplates}
        triggers={triggers} setTriggers={setTriggers}
        projectApiKey={projectApiKey}
        projectApiPreview={projectApiPreview}
        agentApiKeys={agentApiKeys}
        agentApiPreviews={agentApiPreviews}
        loadingApiKeys={loadingApiKeys}
        rotatingKeyId={rotatingKeyId}
        legacyKeyStatus={legacyKeyStatus}
        migratingLegacyKeys={migratingLegacyKeys}
        copiedKey={copiedKey}
        copyToClipboard={copyToClipboard}
        rotateProjectApiKey={rotateProjectApiKey}
        rotateAgentApiKey={rotateAgentApiKey}
        migrateLegacyKeys={migrateLegacyKeys}
        expandedAgentStats={expandedAgentStats}
        setExpandedAgentStats={setExpandedAgentStats}
        openEditAgentDialog={openEditAgentDialog}
        handleDeleteAgent={handleDeleteAgent}
        resetAgentForm={resetAgentForm}
        setAgentDialogOpen={setAgentDialogOpen}
      />

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
