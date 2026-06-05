'use client'

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
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import {
  Menu,
  Settings,
  BookOpen,
  Activity,
  HelpCircle,
  FolderPlus,
  LogOut,
} from 'lucide-react'
import type { Project, ProjectListItem } from '@/types/board'

type ViewType = 'landing' | 'board' | 'runtime' | 'skills' | 'help'
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
}

export function BoardHeader({
  view, setView,
  sidebarOpen, setSidebarOpen,
  projects, currentProject, switchProject,
  wsConnected, realtimeConfigured,
  setProjectDialogOpen, setSettingsTab, handleAdminLogout,
  currentWorkspaceId, setCurrentWorkspaceId,
}: BoardHeaderProps) {
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
              {wsConnected ? 'Live' : realtimeConfigured ? 'Offline' : 'Realtime Off'}
            </div>
          </div>

          <div className="flex items-center gap-3">
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
