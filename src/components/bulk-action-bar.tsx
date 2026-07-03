'use client'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Archive, Trash2, X } from 'lucide-react'
import { statusColumns } from '@/app/_views/board-constants'
import type { TaskStatus } from '@/types/board'

interface BulkActionBarProps {
  count: number
  onMove: (status: TaskStatus) => void
  onArchive: () => void
  onDelete: () => void
  onClear: () => void
}

/**
 * D-3: bulk action bar shown while at least one task is selected. Move-to picks
 * a target status (one batch call), Archive/Delete act on the whole selection,
 * Clear drops the selection. Sticky at the top of the board so it stays reachable
 * while scrolling a long column.
 */
export function BulkActionBar({ count, onMove, onArchive, onDelete, onClear }: BulkActionBarProps) {
  return (
    <div
      role="region"
      aria-label="Bulk task actions"
      className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--op-blue-dim)] bg-card/95 px-3 py-2 shadow-sm backdrop-blur"
    >
      <span className="text-xs font-medium text-foreground">
        {count} selected
      </span>

      <div className="ml-1 flex items-center gap-1.5">
        {/* Move-to: choosing a status fires the move immediately. value stays
            unset (placeholder) so the same target can be picked twice in a row. */}
        <Select value="" onValueChange={(v) => onMove(v as TaskStatus)}>
          <SelectTrigger size="sm" className="h-7 w-[130px] text-xs" aria-label="Move selected tasks to status">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {statusColumns.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onArchive}>
          <Archive className="h-3.5 w-3.5" />
          Archive
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={onClear}
      >
        <X className="h-3 w-3" />
        Clear
      </Button>
    </div>
  )
}
