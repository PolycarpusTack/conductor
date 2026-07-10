'use client'

import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  FolderPlus,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { NoRuntimeBanner } from '@/components/no-runtime-banner'
import { BoardTaskCard } from '@/components/board-task-card'
import { BoardFilterBar } from '@/components/board-filter-bar'
import { BulkActionBar } from '@/components/bulk-action-bar'
import {
  useProjectDataCtx,
  useTaskActions,
  useUiState,
} from '@/app/_views/board-context'
import { useFilteredTasks, isBoardFilterActive } from '@/app/_views/use-filtered-tasks'
import { statusColumns, priorityColors, tagColors, showDemoSeed } from '@/app/_views/board-constants'
import type { Task, TaskStatus } from '@/types/board'

/** Stable empty-array reference so useFilteredTasks' memo isn't invalidated pre-load. */
const EMPTY_TASKS: Task[] = []

/** Drag data carried by every draggable card / droppable column so the end handler can resolve a target status. */
interface DndData {
  status: TaskStatus
  /** Present on cards (draggables) for screen-reader announcements; absent on column droppables. */
  title?: string
}

/**
 * Sortable wrapper: makes a BoardTaskCard a keyboard/pointer draggable whose
 * grip is the drag handle. `memo`-wrapped (E-5): BoardPage re-renders for
 * reasons unrelated to a given card (drag pick-up/drop toggling `activeTask`,
 * a single other task updating) pass identical props here — task identity is
 * preserved for unchanged tasks, the callbacks are useCallback/setter-stable,
 * and priorityColors/tagColors are module constants — so this bails and the
 * `useSortable` subtree is untouched. dnd-kit's own context changes still
 * re-render it during an active drag (memo only blocks parent-prop churn).
 */
const SortableTaskCard = memo(function SortableTaskCard(props: Omit<React.ComponentProps<typeof BoardTaskCard>, 'sortable' | 'overlay'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { status: props.task.status, title: props.task.title } satisfies DndData,
  })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }
  return (
    <BoardTaskCard
      {...props}
      sortable={{ setNodeRef, style, attributes, listeners, isDragging }}
    />
  )
})

/**
 * A status column that accepts drops even when empty (SortableContext alone
 * can't). Exposed as a labelled `group` landmark so a screen reader announces
 * the status name and task count on entry (WCAG 1.3.1 Info and Relationships).
 */
function DroppableColumn({ status, label, count, className, children }: { status: TaskStatus; label: string; count: number; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } satisfies DndData })
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={`${label} column, ${count} ${count === 1 ? 'task' : 'tasks'}`}
      className={cn(className, isOver && 'rounded-lg ring-1 ring-ring/40')}
    >
      {children}
    </div>
  )
}

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

/**
 * E-1: task deep links. `/board?task=<id>` opens the task drawer once the
 * project has loaded, and the URL is kept in sync (history.replaceState, so
 * drawer opens/closes never pollute browser history) whenever the drawer
 * opens or closes — copying the URL from an open drawer reproduces it.
 */
function TaskDeepLinkSync() {
  const searchParams = useSearchParams()
  const { currentProject } = useProjectDataCtx()
  const { selectedTask, setSelectedTask } = useTaskActions()
  // Capture the initial param once; later searchParams changes are our own writes.
  const initialParamRef = useRef(searchParams.get('task'))
  const consumedRef = useRef(false)

  // Consume the deep link once the project is available. Runs before the
  // write effect below (effects fire in declaration order per commit), so the
  // initial ?task=<id> is never stripped before it can be consumed.
  useEffect(() => {
    if (consumedRef.current) return
    const wanted = initialParamRef.current
    if (wanted) {
      if (!currentProject) return // wait for load; auth gate may still be up
      const task = currentProject.tasks.find(t => t.id === wanted)
      if (task) setSelectedTask(task)
    }
    consumedRef.current = true
  }, [currentProject, setSelectedTask])

  // Reflect drawer state into the URL. history.replaceState keeps drawer
  // opens/closes out of browser history so back/forward stays route-level.
  useEffect(() => {
    if (!consumedRef.current) return
    const url = new URL(window.location.href)
    const current = url.searchParams.get('task')
    const next = selectedTask?.id ?? null
    if (current === next) return
    if (next) url.searchParams.set('task', next)
    else url.searchParams.delete('task')
    window.history.replaceState(null, '', url)
  }, [currentProject, selectedTask])

  return null
}

export default function BoardPage() {
  const {
    currentProject,
    loading, loadError, seedingDemoData,
    projectRuntimes,
    settingsSyncedProjectId,
    setProjectDialogOpen,
    initializeBoard, handleSeedDemoData,
  } = useProjectDataCtx()
  const {
    setViewingTaskSteps,
    setSelectedTask,
    mobileColumn, setMobileColumn,
    handleDeleteTask,
    handleDragStart, handleDrop,
    bulkMoveTasks, bulkArchiveTasks, bulkDeleteTasks,
    openEditTaskDialog, openNewTaskDialog,
  } = useTaskActions()
  const { setSettingsTab, boardFilter, clearBoardFilter } = useUiState()

  // D-3: multi-select lives in board-page local state — selection is ephemeral
  // (no need to survive view switches, unlike the D-1 filter slice), so keeping
  // it here is simpler and avoids invalidating unrelated context consumers.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  // Stable callbacks (functional updaters, empty deps) so toggling one card's
  // selection doesn't change the callback identity and re-render every card —
  // only the card whose `selected` boolean flipped re-renders (preserves E-5).
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((on) => {
      if (on) setSelectedIds(new Set()) // leaving select mode drops the selection
      return !on
    })
  }, [])

  // Bulk actions run over the current selection, then clear it (the undo lives
  // on the toast raised by the handler). Selection stays until the batch fires.
  const handleBulkMove = useCallback((status: TaskStatus) => {
    void bulkMoveTasks(Array.from(selectedIds), status)
    setSelectedIds(new Set())
  }, [bulkMoveTasks, selectedIds])
  const handleBulkArchive = useCallback(() => {
    void bulkArchiveTasks(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [bulkArchiveTasks, selectedIds])
  const handleBulkDelete = useCallback(() => {
    void bulkDeleteTasks(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [bulkDeleteTasks, selectedIds])

  // D-1: apply the board filter client-side over the full loaded task set.
  // Inactive filter returns the same array reference, so tasksByStatus below
  // keeps its identity when no filter is applied.
  const allTasks = currentProject?.tasks ?? EMPTY_TASKS
  const filteredTasks = useFilteredTasks(allTasks, boardFilter)
  const filterActive = isBoardFilterActive(boardFilter)
  const totalCount = allTasks.length
  const filteredCount = filteredTasks.length

  // D-1: distinct tags present on the project's tasks, for the filter popover.
  const filterTags = useMemo(() => {
    const set = new Set<string>()
    for (const task of allTasks) {
      if (task.tag) set.add(task.tag)
    }
    return Array.from(set).sort()
  }, [allTasks])

  // E-5: group tasks into per-column arrays ONCE per tasks-change instead of
  // running getTasksByStatus (filter+sort over all tasks) five separate times
  // on every render. Keyed on the FILTERED tasks array identity (D-1), so a
  // re-render that doesn't touch tasks/filter reuses the same map and the same
  // per-column array references — feeding stable `items`/props to the memoized
  // columns and cards. Mirrors getTasksByStatus (status filter + order sort).
  const tasksByStatus = useMemo(() => {
    const grouped = Object.fromEntries(
      statusColumns.map((c) => [c.id, [] as Task[]]),
    ) as Record<TaskStatus, Task[]>
    for (const task of filteredTasks) {
      grouped[task.status]?.push(task)
    }
    for (const status of Object.keys(grouped) as TaskStatus[]) {
      grouped[status].sort((a, b) => a.order - b.order)
    }
    return grouped
  }, [filteredTasks])

  // G-4: per-column ordered id arrays for dnd-kit's SortableContext. Keyed on
  // tasksByStatus so the id array handed to each SortableContext keeps its
  // identity across re-renders that don't touch tasks/filter (e.g. toggling one
  // card's selection). Previously `items={tasks.map((t) => t.id)}` allocated a
  // fresh array for all five columns on EVERY BoardPage render, defeating
  // SortableContext's internal same-items bail. Behaviour is identical — same
  // ids in the same order — only the reference is now stable. (No O(n²): one
  // O(n) pass over the already-grouped tasks, memoized.)
  const itemIdsByStatus = useMemo(() => {
    const ids = {} as Record<TaskStatus, string[]>
    for (const status of Object.keys(tasksByStatus) as TaskStatus[]) {
      ids[status] = tasksByStatus[status].map((t) => t.id)
    }
    return ids
  }, [tasksByStatus])

  // The card currently lifted, mirrored into a DragOverlay so the pointer/
  // keyboard drag has a visible, detached representation.
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  // PointerSensor's 8px activation distance lets a plain click/tap through to
  // the card's onClick (open drawer) instead of starting a drag. KeyboardSensor
  // with sortableKeyboardCoordinates drives pick-up/arrow-move/drop from the grip.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const statusLabel = useMemo(
    () => Object.fromEntries(statusColumns.map((c) => [c.id, c.label])) as Record<TaskStatus, string>,
    [],
  )

  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active }) => `Picked up task ${active.data.current?.title ?? ''}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Task ${active.data.current?.title ?? ''} is over the ${statusLabel[over.id as TaskStatus] ?? String(over.id)} column.`
        : `Task ${active.data.current?.title ?? ''} is no longer over a column.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Task ${active.data.current?.title ?? ''} dropped into the ${statusLabel[over.id as TaskStatus] ?? String(over.id)} column.`
        : `Task ${active.data.current?.title ?? ''} dropped.`,
    onDragCancel: ({ active }) => `Dragging cancelled. Task ${active.data.current?.title ?? ''} returned.`,
  }), [statusLabel])

  const handleDndStart = (event: DragStartEvent) => {
    const task = currentProject?.tasks.find((t) => t.id === event.active.id) ?? null
    setActiveTask(task)
    if (task) handleDragStart(task)
  }

  const resolveStatus = (event: DragEndEvent | DragCancelEvent): TaskStatus | undefined =>
    (event.over?.data.current as DndData | undefined)?.status ??
    (event.active.data.current as DndData | undefined)?.status

  const handleDndEnd = (event: DragEndEvent) => {
    setActiveTask(null)
    // over resolves to the target column (or the hovered card's column); on a
    // miss we fall back to the source status so handleDrop no-ops and clears
    // the dragged task. Same optimistic status-change path native drop used.
    const status = resolveStatus(event)
    if (status) void handleDrop(status)
  }

  const handleDndCancel = (event: DragCancelEvent) => {
    setActiveTask(null)
    // Clear the hook's draggedTask without moving (source === target no-ops).
    const status = resolveStatus(event)
    if (status) void handleDrop(status)
  }

  return (
    <>
      <Suspense fallback={null}>
        <TaskDeepLinkSync />
      </Suspense>
      {/* C-5: dispatch-readiness banner above the board (no runtimes / no agents) */}
      {!loading && currentProject && settingsSyncedProjectId === currentProject.id && (
        <NoRuntimeBanner
          key={currentProject.id}
          projectId={currentProject.id}
          hasAgents={currentProject.agents.length > 0}
          hasRuntimes={projectRuntimes.length > 0}
          onOpenSettings={setSettingsTab}
        />
      )}
      {loading ? (
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
            {/* D-1: search + filter controls above the board (D-3: + Select toggle) */}
            <BoardFilterBar
              agents={currentProject.agents}
              tags={filterTags}
              filteredCount={filteredCount}
              totalCount={totalCount}
              selectionMode={selectionMode}
              onToggleSelectionMode={toggleSelectionMode}
            />

            {/* D-3: bulk action bar — only while at least one task is selected */}
            {selectedIds.size > 0 && (
              <BulkActionBar
                count={selectedIds.size}
                onMove={handleBulkMove}
                onArchive={handleBulkArchive}
                onDelete={handleBulkDelete}
                onClear={clearSelection}
              />
            )}

            {/* D-1: no-filter-match state — distinct from the empty-board (no
                projects) and error states above; only shown when a filter is
                active and hides every task on a non-empty board. */}
            {filterActive && filteredCount === 0 && totalCount > 0 ? (
              <div className="flex min-h-[40vh] items-center justify-center px-6">
                <div className="max-w-md rounded-2xl border border-border/30 bg-card p-6 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40">
                    <Search className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h2 className="text-lg font-semibold">No tasks match your filters</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    None of the {totalCount} task{totalCount === 1 ? '' : 's'} on this board match the current search and filters.
                  </p>
                  <div className="mt-5 flex justify-center">
                    <Button variant="outline" onClick={clearBoardFilter}>
                      <X className="mr-2 h-4 w-4" />
                      Clear filters
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
         <DndContext
           sensors={sensors}
           collisionDetection={closestCorners}
           accessibility={{ announcements }}
           onDragStart={handleDndStart}
           onDragEnd={handleDndEnd}
           onDragCancel={handleDndCancel}
         >
          <>
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
                  <span className="ml-1.5 text-[10px] opacity-60">{tasksByStatus[col.id].length}</span>
                </button>
              ))}
            </div>

            {/* Desktop / tablet board grid */}
            <div role="region" aria-label="Task board" className="hidden xs:flex md:grid md:grid-cols-5 xs:flex-nowrap gap-4 overflow-x-auto">
              {statusColumns.map((column) => {
                const tasks = tasksByStatus[column.id]
                return (
                  <DroppableColumn key={column.id} status={column.id} label={column.label} count={tasks.length} className="min-w-[280px] md:min-w-0">
                    <div className="mb-3 flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium uppercase tracking-wider ${column.color}`}>
                          {column.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{tasks.length}</span>
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

                    <SortableContext items={itemIdsByStatus[column.id]} strategy={verticalListSortingStrategy}>
                      <div className="flex flex-col gap-2">
                        {tasks.map((task) => (
                          <SortableTaskCard
                            key={task.id}
                            task={task}
                            priorityColors={priorityColors}
                            tagColors={tagColors}
                            onOpen={setSelectedTask}
                            onViewSteps={setViewingTaskSteps}
                            onEdit={openEditTaskDialog}
                            onDelete={handleDeleteTask}
                            liveActivity
                            selectable={selectionMode}
                            selected={selectedIds.has(task.id)}
                            onToggleSelect={toggleSelect}
                          />
                        ))}

                        <button
                          onClick={() => openNewTaskDialog(column.id)}
                          className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground hover:border-border/50 hover:text-foreground transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Add task
                        </button>
                      </div>
                    </SortableContext>
                  </DroppableColumn>
                )
              })}
            </div>

            {/* Mobile: single column view */}
            <div className="xs:hidden">
              {statusColumns
                .filter((col) => col.id === mobileColumn)
                .map((column) => {
                  const columnTasks = tasksByStatus[column.id]
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
                          selectable={selectionMode}
                          selected={selectedIds.has(task.id)}
                          onToggleSelect={toggleSelect}
                        />
                      ))}

                      <button
                        onClick={() => openNewTaskDialog(column.id)}
                        className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground hover:border-border/50 hover:text-foreground transition-colors w-full"
                      >
                        <Plus className="h-3 w-3" />
                        Add task
                      </button>

                      {columnTasks.length === 0 && (
                        <div className="text-xs text-muted-foreground text-center py-8">No tasks</div>
                      )}
                    </div>
                  )
                })}
            </div>
          </>

          {/* Detached representation of the lifted card during a drag. */}
          <DragOverlay>
            {activeTask ? (
              <BoardTaskCard
                task={activeTask}
                priorityColors={priorityColors}
                tagColors={tagColors}
                onOpen={setSelectedTask}
                onViewSteps={setViewingTaskSteps}
                liveActivity
                overlay
              />
            ) : null}
          </DragOverlay>
         </DndContext>
            )}
          </div>
        </ScrollArea>
      )}
    </>
  )
}
