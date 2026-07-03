'use client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  FolderPlus,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { RuntimeDashboard } from '@/components/runtime-dashboard'
import { SkillsPage } from '@/components/skills-page'
import { AgentCreationModal } from '@/components/agent-creation-modal'
import { AgentWizardModal } from '@/components/agent-wizard-modal'
import { StepOutputViewer } from '@/components/step-output-viewer'
import { TaskDetailDrawer } from '@/components/task-detail-drawer'
import { HelpPage } from '@/components/help-page'
import { BoardHeader } from '@/components/board-header'
import { NoRuntimeBanner } from '@/components/no-runtime-banner'
import { BoardTaskCard } from '@/components/board-task-card'
import { BoardSidebar } from '@/components/board-sidebar'
import { TaskDialog } from '@/components/task-dialog'
import { ChainDialog } from '@/components/chain-dialog'
import { ProjectDialog } from '@/components/project-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import {
  useProjectDataCtx,
  useTaskActions,
  useAgentActions,
  useUiState,
  useLiveAgentLogs,
} from './board-context'
import { statusColumns, priorityColors, tagColors, showDemoSeed } from './board-constants'
import type { TaskStatus } from '@/types/board'

// Re-exported for compatibility; canonical definitions live in board-context.tsx (E-3).
export type { ViewType, SettingsTabType } from './board-context'

/** Card-shaped placeholder mirroring BoardTaskCard's box (rounded-lg border bg-card p-3). */
function BoardCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-3">
      <div className="flex items-start gap-1.5">
        <Skeleton className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <Skeleton className="mt-2 h-2.5 w-1/2" />
    </div>
  )
}

/**
 * Skeleton board shown during the initial project load. Mirrors the loaded
 * board's containers exactly (p-4 wrapper, mobile tab row, `md:grid-cols-5`
 * desktop grid, per-column header row) so content arriving causes no layout shift.
 */
function BoardSkeleton({ columnCount }: { columnCount: number }) {
  const columns = Array.from({ length: columnCount }, (_, i) => i)
  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-hidden" aria-busy="true" aria-label="Loading board">
      <div className="p-4">
        {/* Mobile column tabs */}
        <div className="flex xs:hidden gap-1 mb-3 overflow-x-auto pb-1">
          {columns.map((i) => (
            <Skeleton key={i} className="h-7 w-20 flex-shrink-0 rounded-md" />
          ))}
        </div>

        {/* Desktop / tablet board grid */}
        <div className="hidden xs:flex md:grid md:grid-cols-5 xs:flex-nowrap gap-4 overflow-x-auto">
          {columns.map((col) => (
            <div key={col} className="min-w-[280px] md:min-w-0">
              <div className="mb-3 flex h-5 items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-4" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {Array.from({ length: col % 2 === 0 ? 3 : 2 }, (_, i) => (
                  <BoardCardSkeleton key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Mobile: single column */}
        <div className="xs:hidden space-y-2">
          <Skeleton className="mb-2 h-5 w-24" />
          {[0, 1, 2].map((i) => (
            <BoardCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

export function BoardView() {
  const {
    currentProject, setCurrentProject,
    loading, loadError, seedingDemoData,
    projectModes, projectRuntimes, projectMcpConnections,
    settingsSyncedProjectId,
    setProjectDialogOpen,
    fetchProject, initializeBoard, handleSeedDemoData,
    getTasksByStatus,
  } = useProjectDataCtx()
  const {
    viewingTaskSteps, setViewingTaskSteps,
    selectedTask, setSelectedTask,
    mobileColumn, setMobileColumn,
    handleDeleteTask,
    handleDragStart, handleDragOver, handleDrop,
    openEditTaskDialog, openNewTaskDialog,
  } = useTaskActions()
  const {
    editingAgent, setEditingAgent,
    agentDialogOpen, setAgentDialogOpen,
    wizardOpen, setWizardOpen,
  } = useAgentActions()
  const { view, setView, setSettingsTab, currentWorkspaceId, authError } = useUiState()
  const liveAgentLogs = useLiveAgentLogs()

  return (
    <div className="min-h-screen bg-background dark">
      <BoardHeader />

      <main className="pt-14 flex">
        <BoardSidebar />

        {/* Board canvas */}
        <div className="flex-1 overflow-hidden">
          {authError && (
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {authError}
            </div>
          )}
          {/* C-5: dispatch-readiness banner above the board (no runtimes / no agents) */}
          {view === 'board' && !loading && currentProject && settingsSyncedProjectId === currentProject.id && (
            <NoRuntimeBanner
              key={currentProject.id}
              projectId={currentProject.id}
              hasAgents={currentProject.agents.length > 0}
              hasRuntimes={projectRuntimes.length > 0}
              onOpenSettings={setSettingsTab}
            />
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
            <BoardSkeleton columnCount={statusColumns.length} />
          ) : !currentProject && loadError ? (
            <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
              <div className="max-w-md rounded-2xl border border-destructive/30 bg-card p-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <h2 className="text-lg font-semibold">Couldn&apos;t load the board</h2>
                <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
                <div className="mt-5 flex justify-center">
                  <Button variant="outline" onClick={() => initializeBoard()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                </div>
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
