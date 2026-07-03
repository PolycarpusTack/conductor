'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ChevronDown, Pause, Play, Plus } from 'lucide-react'
import { APP_VERSION_SHORT } from '@/lib/version'
import { useToast } from '@/hooks/use-toast'
import { toggleAgentActive } from '@/hooks/useAgentManager'
import { useProjectDataCtx, useTaskActions, useAgentActions, useUiState } from '@/app/_views/board-context'

/**
 * Shared sidebar body — the SAME authoring surface rendered two ways (E-7):
 * a static <aside> at md+, and inside a slide-over Sheet below md so agent
 * authoring (Create Agent / Wizard / Create Chain / project switch / agent
 * list) is reachable on phones. `onNavigate` closes the mobile Sheet after a
 * tap; at md+ it is undefined (no-op) so the static layout is unchanged.
 */
function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { projects, currentProject, setCurrentProject, switchProject } = useProjectDataCtx()
  const { openNewChainDialog } = useTaskActions()
  const { openEditAgentDialog, setEditingAgent, setAgentDialogOpen, setWizardOpen } = useAgentActions()
  const { toast } = useToast()

  const close = () => onNavigate?.()

  return (
    <>
      <div className="mb-4 flex items-center gap-1.5">
        <div className="h-3 w-3 rounded bg-primary/60" />
        <span className="text-[10px] font-medium text-foreground/50">Conductor {APP_VERSION_SHORT}</span>
      </div>

      <div className="mb-4">
        <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-2 px-2">Projects</h3>
        <div className="space-y-0.5">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { switchProject(p.id); close() }}
              className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] font-medium flex items-center gap-2 ${p.id === currentProject?.id ? 'bg-surface/60 text-foreground/70' : 'text-muted-foreground/50 hover:bg-surface/40'}`}
            >
              <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <Separator className="my-4" />

      <div className="mt-4">
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex items-center justify-between w-full px-2 mb-2 group">
            <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40">
              Agents
              {currentProject?.agents && (
                <span className="ml-1.5 normal-case tracking-normal">
                  {currentProject.agents.filter(a => a.isActive).length}/{currentProject.agents.length}
                </span>
              )}
            </h3>
            <ChevronDown className="h-3 w-3 text-muted-foreground/30 transition-transform group-data-[state=closed]:-rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-[220px] overflow-y-auto space-y-0.5">
              {currentProject?.agents
                .slice()
                .sort((a, b) => {
                  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
                  const aCount = currentProject.tasks.filter(t => t.agent?.id === a.id && t.status !== 'DONE').length
                  const bCount = currentProject.tasks.filter(t => t.agent?.id === b.id && t.status !== 'DONE').length
                  if (aCount !== bCount) return bCount - aCount
                  return a.name.localeCompare(b.name)
                })
                .map((agent) => {
                  const taskCount = currentProject!.tasks.filter(t => t.agent?.id === agent.id && t.status !== 'DONE').length
                  return (
                    <div
                      key={agent.id}
                      className={`group/agent flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface/40 transition-colors cursor-pointer ${!agent.isActive && taskCount === 0 ? 'opacity-40' : ''}`}
                      onClick={() => { void openEditAgentDialog(agent); close() }}
                    >
                      <span className="text-sm">{agent.emoji}</span>
                      <span className="text-[11px] text-foreground/70 flex-1 truncate">{agent.name}</span>
                      {!agent.isActive && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-medium uppercase tracking-wide border border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] text-[var(--op-amber)]">
                          Paused
                        </span>
                      )}
                      {agent.isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                      {taskCount > 0 && (
                        <span className="text-[9px] text-muted-foreground/50 shrink-0">{taskCount}</span>
                      )}
                      <button
                        type="button"
                        title={agent.isActive ? `Pause ${agent.name} (stop dispatching)` : `Resume ${agent.name}`}
                        aria-label={agent.isActive ? `Pause ${agent.name}` : `Resume ${agent.name}`}
                        onClick={(e) => { e.stopPropagation(); void toggleAgentActive(agent, { setCurrentProject, toast }) }}
                        className={`shrink-0 rounded p-0.5 hover:text-foreground/70 hover:bg-surface/60 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-opacity ${agent.isActive ? 'text-muted-foreground/40 opacity-0 group-hover/agent:opacity-100' : 'text-[var(--op-amber)] opacity-100'}`}
                      >
                        {agent.isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </button>
                    </div>
                  )
                })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <Separator className="my-4" />

      <div className="mt-4">
        <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-2 px-2">Tags</h3>
        <div className="flex flex-wrap gap-1 px-2">
          {Array.from(new Set(currentProject?.tasks.map(t => t.tag).filter(Boolean))).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-4 p-3 border-t border-border/20 space-y-2">
        <Button
          variant="outline"
          className="w-full text-xs"
          onClick={() => { setEditingAgent(null); setAgentDialogOpen(true); close() }}
        >
          <Plus className="h-3 w-3 mr-2" />
          Create Agent
        </Button>
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setWizardOpen(true); close() }}>
          ✨ Wizard
        </Button>
        <Button variant="outline" className="w-full text-xs" onClick={() => { openNewChainDialog(); close() }}>
          <Plus className="h-3 w-3 mr-2" />
          Create Chain
        </Button>
      </div>
    </>
  )
}

export function BoardSidebar() {
  const { sidebarOpen, setSidebarOpen } = useUiState()
  return (
    <>
      {/* md+ : static sidebar, visually unchanged */}
      <aside className="hidden md:block w-56 shrink-0 border-r border-border/15 p-3 min-h-[calc(100vh-3.5rem)]">
        <SidebarBody />
      </aside>

      {/* below md : the same authoring surface as a slide-over Sheet,
          driven by the header hamburger's existing sidebarOpen state */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="md:hidden w-72 p-0">
          <SheetHeader className="pb-0">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <SidebarBody onNavigate={() => setSidebarOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
