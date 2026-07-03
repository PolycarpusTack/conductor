'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Activity, ChevronDown, ChevronRight, CopyPlus, Library,
  Pause, Pencil, Play, Plus, Search, Trash2,
} from 'lucide-react'
import { AgentActivityDashboard } from '@/components/agent-activity-dashboard'
import { useToast } from '@/hooks/use-toast'
import { toggleAgentActive } from '@/hooks/useAgentManager'
import { useProjectDataCtx } from '@/app/_views/board-context'
import type { Agent } from '@/types/board'

interface LibraryCategory {
  name: string
  emoji: string
  count: number
  agents: Array<{ name: string; description: string }>
}

interface SettingsAgentsProps {
  projectId: string
  agents: Agent[]
  hasRuntimes: boolean
  onAddAgent: () => void
  onEditAgent: (agent: Agent) => void
  onDeleteAgent: (id: string) => void
  onDuplicateAgent: (id: string) => void
  onImported: () => void
}

/**
 * Agents tab (presentation overhaul): with the bundled library a project can
 * hold 100+ agents, so the flat list becomes searchable, grouped-by-category
 * collapsibles — categories collapsed by default once a project grows past a
 * handful of agents.
 */
export function SettingsAgents({
  projectId, agents, hasRuntimes,
  onAddAgent, onEditAgent, onDeleteAgent, onDuplicateAgent, onImported,
}: SettingsAgentsProps) {
  const { setCurrentProject } = useProjectDataCtx()
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [expandedStats, setExpandedStats] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // Library import panel
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryCategories, setLibraryCategories] = useState<LibraryCategory[]>([])
  const [libraryChainCount, setLibraryChainCount] = useState(0)
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())
  const [includeChains, setIncludeChains] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  useEffect(() => {
    if (!libraryOpen || libraryCategories.length > 0) return
    fetch('/api/agent-library', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return
        setLibraryCategories(data.categories)
        setLibraryChainCount(data.chains.length)
        setSelectedCategories(new Set(data.categories.map((c: LibraryCategory) => c.name)))
      })
      .catch(() => {})
  }, [libraryOpen, libraryCategories.length])

  const runImport = async () => {
    setImporting(true)
    setImportResult(null)
    try {
      const allSelected = selectedCategories.size === libraryCategories.length
      const res = await fetch(`/api/projects/${projectId}/agent-library/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(allSelected ? {} : { categories: [...selectedCategories] }),
          includeChains,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Import failed')
      setImportResult(
        `Imported ${data.agentsCreated} agents (${data.agentsSkipped} already present)` +
        (includeChains ? ` and ${data.chainsCreated} chains (${data.chainsSkipped} skipped)` : '') + '.',
      )
      onImported()
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  // Group agents by category; search filters across name/role/description.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? agents.filter(a =>
          a.name.toLowerCase().includes(q) ||
          (a.role ?? '').toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q) ||
          (a.category ?? '').toLowerCase().includes(q))
      : agents
    const map = new Map<string, Agent[]>()
    for (const agent of filtered) {
      const key = agent.category || 'General'
      const list = map.get(key) ?? []
      list.push(agent)
      map.set(key, list)
    }
    // General first, then alphabetical
    return [...map.entries()].sort(([a], [b]) =>
      a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b))
  }, [agents, search])

  // Default-open behavior: everything open while small or searching;
  // collapsed once the project holds a real library.
  const defaultOpen = agents.length <= 12 || search.trim().length > 0
  const isOpen = (group: string) => openGroups[group] ?? defaultOpen
  const singleGroup = groups.length === 1

  const agentRow = (agent: Agent) => (
    <div key={agent.id} className="rounded-lg border border-border/30">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl shrink-0">{agent.emoji}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-2">
              <span className="truncate">{agent.name}</span>
              {agent.isActive ? (
                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shrink-0">
                  Active
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] shrink-0 border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] text-[var(--op-amber)]">
                  Paused
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">{agent.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            title={agent.isActive ? 'Pause agent (stop dispatching)' : 'Resume agent'}
            aria-label={agent.isActive ? `Pause ${agent.name}` : `Resume ${agent.name}`}
            onClick={() => void toggleAgentActive(agent, { setCurrentProject, toast })}
          >
            {agent.isActive
              ? <Pause className="h-3 w-3" />
              : <Play className="h-3 w-3 text-[var(--op-amber)]" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpandedStats(expandedStats === agent.id ? null : agent.id)}>
            <Activity className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" title="Duplicate agent" onClick={() => onDuplicateAgent(agent.id)}>
            <CopyPlus className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onEditAgent(agent)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onDeleteAgent(agent.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {expandedStats === agent.id && (
        <div className="px-3 pb-3">
          <AgentActivityDashboard agentId={agent.id} />
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Search + counts */}
      {agents.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${agents.length} agents by name, role, or description…`}
            className="pl-8 h-9 text-sm"
          />
        </div>
      )}

      {/* Grouped agent list */}
      {groups.map(([group, groupAgents]) =>
        singleGroup && group === 'General' ? (
          <div key={group} className="space-y-3">{groupAgents.map(agentRow)}</div>
        ) : (
          <div key={group} className="rounded-lg border border-border/20">
            <button
              className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-muted/20 rounded-lg"
              onClick={() => setOpenGroups(prev => ({ ...prev, [group]: !isOpen(group) }))}
            >
              {isOpen(group) ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
              <span className="text-sm font-medium flex-1">{group}</span>
              <span className="text-xs text-muted-foreground">
                {groupAgents.filter(a => a.isActive).length > 0 && `${groupAgents.filter(a => a.isActive).length} active · `}
                {groupAgents.length}
              </span>
            </button>
            {isOpen(group) && (
              <div className="space-y-2 p-2 pt-0">{groupAgents.map(agentRow)}</div>
            )}
          </div>
        ),
      )}
      {groups.length === 0 && search && (
        <p className="text-xs text-muted-foreground text-center py-3">No agents match “{search}”.</p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onAddAgent}
          disabled={!hasRuntimes}
          title={!hasRuntimes ? 'Add a runtime first — agents need one to dispatch' : undefined}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Agent
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setLibraryOpen(o => !o)}>
          <Library className="h-4 w-4 mr-2" />
          Import from Library
        </Button>
      </div>

      {/* Library import panel */}
      {libraryOpen && (
        <div className="rounded-lg border border-border/30 bg-card/30 p-3 space-y-3">
          <div>
            <p className="text-sm font-medium">Agent Library</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              ~100 specialist agents with full system prompts, plus {libraryChainCount} ready-made
              workflow chains. Import is additive — existing names are never overwritten. Imported
              agents start <strong>inactive</strong>; assign a runtime and activate the ones you need.
            </p>
          </div>
          {libraryCategories.length === 0 ? (
            // Category-row skeletons matching the loaded checkbox grid (grid-cols-2, p-1.5 rows)
            <div className="grid grid-cols-2 gap-1.5" aria-busy="true" aria-label="Loading agent catalog">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 p-1.5">
                  <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-5 shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {libraryCategories.map((cat) => (
                  <label key={cat.name} className="flex items-center gap-2 text-xs cursor-pointer p-1.5 rounded hover:bg-muted/20">
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(cat.name)}
                      onChange={(e) => {
                        setSelectedCategories(prev => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(cat.name)
                          else next.delete(cat.name)
                          return next
                        })
                      }}
                    />
                    <span className="flex-1">{cat.emoji} {cat.name}</span>
                    <span className="text-muted-foreground">{cat.count}</span>
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={includeChains} onChange={e => setIncludeChains(e.target.checked)} />
                Also import workflow chains (only those fully covered by the selected categories)
              </label>
              {importResult && <p className="text-xs text-muted-foreground">{importResult}</p>}
              <Button size="sm" className="w-full" onClick={runImport} disabled={importing || selectedCategories.size === 0}>
                {importing ? 'Importing…' : `Import ${[...selectedCategories].length === libraryCategories.length ? 'everything' : `${[...selectedCategories].reduce((n, c) => n + (libraryCategories.find(lc => lc.name === c)?.count ?? 0), 0)} agents`}`}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
