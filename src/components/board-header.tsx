'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { DeadLetterPanel } from '@/components/dead-letter-panel'
import { NotificationCenter } from '@/components/notification-center'
import {
  Menu,
  Settings,
  BookOpen,
  Activity,
  HelpCircle,
  FolderPlus,
  LogOut,
  AlertTriangle,
} from 'lucide-react'
import type { Project, ProjectListItem } from '@/types/board'

type ViewType = 'landing' | 'board' | 'runtime' | 'skills' | 'help'

function formatUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`
}

/** Lightweight count read of the existing dead-letters endpoint. null = fetch failed. */
async function fetchDeadLetterCount(projectId: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/projects/${projectId}/dead-letters`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data?.deadLetters) ? data.deadLetters.length : 0
  } catch {
    return null
  }
}
type SettingsTabType = 'general' | 'agents' | 'api' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null

interface BoardHeaderProps {
  view: ViewType
  setView: (v: ViewType) => void
  sidebarOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  projects: ProjectListItem[]
  currentProject: Project | null
  switchProject: (id: string) => Promise<void>
  wsConnected: boolean
  realtimeConfigured: boolean
  setProjectDialogOpen: Dispatch<SetStateAction<boolean>>
  setSettingsTab: (tab: SettingsTabType) => void
  handleAdminLogout: () => void
  currentWorkspaceId: string | null
  setCurrentWorkspaceId: (id: string | null) => void
  notificationVersion?: number
  onOpenTask?: (taskId: string) => void
}

export function BoardHeader({
  view, setView,
  sidebarOpen, setSidebarOpen,
  projects, currentProject, switchProject,
  wsConnected, realtimeConfigured,
  setProjectDialogOpen, setSettingsTab, handleAdminLogout,
  currentWorkspaceId, setCurrentWorkspaceId,
  notificationVersion, onOpenTask,
}: BoardHeaderProps) {
  // C-5: dead-letter count chip. No polling — refreshed whenever the project
  // payload is refetched (the WS step-failed/chain-* handlers replace
  // currentProject, which re-runs this effect) and when the panel dialog closes.
  // The count is keyed by project id so a stale count never shows mid-switch.
  const [deadLetters, setDeadLetters] = useState<{ projectId: string; count: number } | null>(null)
  const [deadLettersOpen, setDeadLettersOpen] = useState(false)

  const refreshDeadLetterCount = useCallback(() => {
    if (!currentProject) return
    const projectId = currentProject.id
    void fetchDeadLetterCount(projectId).then((count) => {
      // null = failed refresh; the chip is informational, keep the previous count
      if (count !== null) setDeadLetters({ projectId, count })
    })
  }, [currentProject])

  useEffect(() => {
    if (!currentProject) return
    const projectId = currentProject.id
    let cancelled = false
    void fetchDeadLetterCount(projectId).then((count) => {
      if (!cancelled && count !== null) setDeadLetters({ projectId, count })
    })
    return () => { cancelled = true }
  }, [currentProject])

  const deadLetterCount =
    currentProject && deadLetters?.projectId === currentProject.id ? deadLetters.count : 0

  const wsLabel = wsConnected ? 'Live' : realtimeConfigured ? 'Offline' : 'Realtime Off'

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(v => !v)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <a className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
              <img src="/icon.png" alt="Conductor" className="h-6 w-6 rounded-md" />
              <span className="text-sm font-semibold tracking-tight font-heading">Conductor</span>
            </a>

            <WorkspaceSwitcher
              currentWorkspaceId={currentWorkspaceId}
              onSwitch={(id) => setCurrentWorkspaceId(id)}
            />

            <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono ${wsConnected ? 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]' : 'bg-muted text-muted-foreground'}`}>
              <div className={`h-1.5 w-1.5 rounded-full ${wsConnected ? 'bg-[var(--op-teal)] animate-pulse' : 'bg-muted-foreground/50'}`} />
              {wsLabel}
            </div>

            {/* C-5: compact dot-only realtime indicator below the sm breakpoint */}
            <div className="flex sm:hidden items-center" title={wsLabel}>
              <div className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-[var(--op-teal)] animate-pulse' : 'bg-muted-foreground/50'}`} />
              <span className="sr-only">{wsLabel}</span>
            </div>

            {/* B-7: month-to-date spend vs budget; destructive chip while dispatch is budget-paused */}
            {currentProject?.budgetUsd != null && (() => {
              const budget = currentProject.budgetUsd
              const spent = currentProject.spentThisMonthUsd ?? 0
              const paused = spent >= budget
              return paused ? (
                <div
                  className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono bg-[var(--op-red-bg)] text-[var(--op-red)] border border-[var(--op-red-dim)]"
                  title="Monthly budget reached — agent dispatch is paused until the budget is raised"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-[var(--op-red)]" />
                  Budget paused · {formatUsd(spent)} / {formatUsd(budget)}
                </div>
              ) : (
                <span
                  className="hidden sm:inline text-[10px] font-mono text-muted-foreground/60"
                  title="Month-to-date recorded spend / monthly budget"
                >
                  {formatUsd(spent)} / {formatUsd(budget)}
                </span>
              )
            })()}

            {/* C-5: dead-letter count chip — opens the requeue panel */}
            {currentProject && deadLetterCount > 0 && (
              <button
                onClick={() => setDeadLettersOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono bg-[var(--op-red-bg)] text-[var(--op-red)] border border-[var(--op-red-dim)] hover:bg-[var(--op-red)]/15 transition-colors cursor-pointer"
                title="Dead-lettered steps — exhausted retries; click to review and requeue"
              >
                <AlertTriangle className="h-3 w-3" />
                {deadLetterCount}
                <span className="hidden md:inline">dead-lettered</span>
                <span className="sr-only">dead-lettered steps — open panel</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* C-4: notification bell — review gates, dead letters, budget pauses */}
            {currentProject && (
              <NotificationCenter
                projectId={currentProject.id}
                refreshSignal={notificationVersion}
                onTaskClick={onOpenTask}
              />
            )}
            {projects.length > 1 && (
              <Select value={currentProject?.id} onValueChange={switchProject}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {currentProject?.agents && (() => {
              const activeAgents = currentProject.agents.filter(a => a.isActive)
              const totalAgents = currentProject.agents.length
              const MAX_SHOWN = 5
              const shown = activeAgents.slice(0, MAX_SHOWN)
              const overflowCount = activeAgents.length - MAX_SHOWN

              return (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="hidden sm:flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface/40 transition-colors">
                      {shown.length > 0 ? shown.map((agent) => (
                        <div key={agent.id} className="relative">
                          <Avatar className="h-6 w-6 border border-border/30 bg-surface">
                            <AvatarFallback className="text-[10px] bg-transparent">{agent.emoji}</AvatarFallback>
                          </Avatar>
                          <div className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
                        </div>
                      )) : (
                        <span className="text-[10px] text-muted-foreground/50">No active agents</span>
                      )}
                      {overflowCount > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-0.5">+{overflowCount}</span>
                      )}
                      <span className="text-[9px] text-muted-foreground/40 ml-1">{activeAgents.length}/{totalAgents}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                      Agents ({activeAgents.length} active / {totalAgents} total)
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-0.5 mt-1">
                      {currentProject.agents
                        .slice()
                        .sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1))
                        .map((agent) => {
                          const taskCount = currentProject.tasks.filter(t => t.agent?.id === agent.id && t.status !== 'DONE').length
                          return (
                            <div key={agent.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] ${agent.isActive ? 'text-foreground/80' : 'text-muted-foreground/40'}`}>
                              <span className="text-sm">{agent.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{agent.name}</span>
                                  {agent.invocationMode === 'DAEMON' && (
                                    <span className="text-[8px] px-1 py-0 rounded bg-violet-500/15 text-violet-500 border border-violet-500/20 shrink-0">DAEMON</span>
                                  )}
                                </div>
                                {agent.role && (
                                  <span className="text-[9px] text-muted-foreground/50 capitalize">{agent.role}</span>
                                )}
                              </div>
                              {agent.isActive && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
                              {taskCount > 0 && <span className="text-[9px] text-muted-foreground/50">{taskCount}</span>}
                            </div>
                          )
                        })}
                    </div>
                  </PopoverContent>
                </Popover>
              )
            })()}

            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => setProjectDialogOpen(true)}
            >
              <FolderPlus className="h-3 w-3" />
              <span className="hidden sm:inline">New Project</span>
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsTab('general')}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'skills' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'skills' ? 'board' : 'skills')}
              title="Skills Library"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'runtime' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'runtime' ? 'board' : 'runtime')}
              title="Runtime Dashboard"
            >
              <Activity className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'help' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'help' ? 'board' : 'help')}
              title="Help & User Guide"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleAdminLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* C-5: the existing dead-letter panel (settings → activity) surfaced from the board */}
      {currentProject && (
        <Dialog
          open={deadLettersOpen}
          onOpenChange={(open) => {
            setDeadLettersOpen(open)
            if (!open) void refreshDeadLetterCount()
          }}
        >
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Dead-lettered steps</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] overflow-y-auto">
              <DeadLetterPanel projectId={currentProject.id} showWhenEmpty />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm md:hidden pt-14">
          <div className="p-4">
            <div className="mb-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/50 mb-2">Projects</h3>
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { switchProject(p.id); setSidebarOpen(false) }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm ${p.id === currentProject?.id ? 'bg-surface/60' : 'hover:bg-surface/40'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
