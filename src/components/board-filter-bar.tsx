'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useUiState } from '@/app/_views/board-context'
import { isBoardFilterActive, type BoardFilter } from '@/app/_views/use-filtered-tasks'
import type { Agent, TaskPriority } from '@/types/board'

/** Sentinel Select value for the "any" option — Radix Select forbids empty-string item values. */
const ANY = '__any__'

const PRIORITY_OPTIONS: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

/** Count of populated filter dimensions, for the trigger badge. */
function activeDimensionCount(filter: BoardFilter): number {
  let n = 0
  if (filter.text.trim() !== '') n += 1
  if (filter.agentId !== null) n += 1
  if (filter.priority !== null) n += 1
  if (filter.tag !== null) n += 1
  if (filter.overdue) n += 1
  return n
}

interface BoardFilterBarProps {
  agents: Agent[]
  /** Distinct tags present on the project's tasks. */
  tags: string[]
  filteredCount: number
  totalCount: number
}

/**
 * D-1: board search + filter controls, rendered directly above the board grid.
 * Reads/writes the filter slice from UiState so it survives view switches; the
 * board (BoardPage) consumes the same slice via useFilteredTasks. Native input
 * + Radix Select/Popover keep it keyboard-accessible; the row wraps and the
 * controls stay reachable below md.
 */
export function BoardFilterBar({ agents, tags, filteredCount, totalCount }: BoardFilterBarProps) {
  const { boardFilter, setBoardFilter, clearBoardFilter } = useUiState()
  const active = isBoardFilterActive(boardFilter)
  const dimensions = activeDimensionCount(boardFilter)

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Text search */}
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          type="search"
          value={boardFilter.text}
          onChange={(e) => setBoardFilter((f) => ({ ...f, text: e.target.value }))}
          placeholder="Search tasks..."
          aria-label="Search tasks by title or description"
          className="h-8 pl-8 text-xs"
        />
      </div>

      {/* Filter popover: agent / priority / tag */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            aria-label="Filter tasks"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filter</span>
            {dimensions > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--op-blue-bg)] px-1 text-[10px] font-medium text-[var(--op-blue)]">
                {dimensions}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-3 p-3">
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Agent</label>
            <Select
              value={boardFilter.agentId ?? ANY}
              onValueChange={(v) => setBoardFilter((f) => ({ ...f, agentId: v === ANY ? null : v }))}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Any agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any agent</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="mr-1">{a.emoji}</span>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Priority</label>
            <Select
              value={boardFilter.priority ?? ANY}
              onValueChange={(v) => setBoardFilter((f) => ({ ...f, priority: v === ANY ? null : (v as TaskPriority) }))}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Any priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any priority</SelectItem>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Tag</label>
            <Select
              value={boardFilter.tag ?? ANY}
              onValueChange={(v) => setBoardFilter((f) => ({ ...f, tag: v === ANY ? null : v }))}
              disabled={tags.length === 0}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder={tags.length === 0 ? 'No tags' : 'Any tag'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any tag</SelectItem>
                {tags.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* D-2: overdue-only toggle */}
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-foreground">
            <Checkbox
              checked={boardFilter.overdue}
              onCheckedChange={(checked) =>
                setBoardFilter((f) => ({ ...f, overdue: checked === true }))
              }
              aria-label="Show only overdue tasks"
            />
            Overdue only
          </label>
        </PopoverContent>
      </Popover>

      {/* Result count */}
      <span className="text-[11px] text-muted-foreground/70" aria-live="polite">
        {active ? `Showing ${filteredCount} of ${totalCount}` : `${totalCount} task${totalCount === 1 ? '' : 's'}`}
      </span>

      {/* Clear-all */}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={clearBoardFilter}
        >
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}
    </div>
  )
}
