'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { ChevronDown, Plus } from 'lucide-react'
import { APP_VERSION_SHORT } from '@/lib/version'
import { useProjectDataCtx, useTaskActions, useAgentActions } from '@/app/_views/board-context'

export function BoardSidebar() {
  const { projects, currentProject, switchProject } = useProjectDataCtx()
  const { openNewChainDialog } = useTaskActions()
  const { openEditAgentDialog, setEditingAgent, setAgentDialogOpen, setWizardOpen } = useAgentActions()
  return (
    <aside className="hidden md:block w-56 shrink-0 border-r border-border/15 p-3 min-h-[calc(100vh-3.5rem)]">
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
              onClick={() => switchProject(p.id)}
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
                      className={`flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface/40 transition-colors cursor-pointer ${!agent.isActive && taskCount === 0 ? 'opacity-40' : ''}`}
                      onClick={() => openEditAgentDialog(agent)}
                    >
                      <span className="text-sm">{agent.emoji}</span>
                      <span className="text-[11px] text-foreground/70 flex-1 truncate">{agent.name}</span>
                      {agent.isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                      {taskCount > 0 && (
                        <span className="text-[9px] text-muted-foreground/50 shrink-0">{taskCount}</span>
                      )}
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

      <div className="p-3 border-t border-border/20 space-y-2">
        <Button
          variant="outline"
          className="w-full text-xs"
          onClick={() => { setEditingAgent(null); setAgentDialogOpen(true) }}
        >
          <Plus className="h-3 w-3 mr-2" />
          Create Agent
        </Button>
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setWizardOpen(true)}>
          ✨ Wizard
        </Button>
        <Button variant="outline" className="w-full text-xs" onClick={openNewChainDialog}>
          <Plus className="h-3 w-3 mr-2" />
          Create Chain
        </Button>
      </div>
    </aside>
  )
}
