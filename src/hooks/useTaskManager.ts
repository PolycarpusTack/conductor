'use client'

import { useState, useCallback, createElement } from 'react'
import { useToast } from '@/hooks/use-toast'
import { ToastAction, type ToastActionElement } from '@/components/ui/toast'
import { ApiClientError } from '@/lib/api/client'
import { tasksApi } from '@/lib/api/endpoints'
import type { Task, TaskStatus, TaskPriority, TaskStepSummary, Project } from '@/types/board'
import type { StepDraft } from '@/types/settings'

/** Re-insert snapshot tasks that are no longer present (undo of a bulk remove). */
function mergeBackTasks(current: Task[], snapshot: Task[]): Task[] {
  const present = new Set(current.map((t) => t.id))
  const restored = snapshot.filter((t) => !present.has(t.id))
  return restored.length > 0 ? [...current, ...restored] : current
}

interface UseTaskManagerParams {
  currentProject: Project | null
  setCurrentProject: React.Dispatch<React.SetStateAction<Project | null>>
}

export function useTaskManager({ currentProject, setCurrentProject }: UseTaskManagerParams) {
  const { toast } = useToast()

  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [chainDialogOpen, setChainDialogOpen] = useState(false)
  const [viewingTaskSteps, setViewingTaskSteps] = useState<{ id: string; title: string; steps: TaskStepSummary[] } | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>('IN_PROGRESS')

  // Form state
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('BACKLOG')
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('MEDIUM')
  const [taskTag, setTaskTag] = useState('')
  const [taskAgentId, setTaskAgentId] = useState<string>('')
  const [taskNotes, setTaskNotes] = useState('')
  const [taskRuntimeOverride, setTaskRuntimeOverride] = useState<string>('')
  // D-2: due date as the native date input's value ("YYYY-MM-DD"), '' = none.
  const [taskDueDate, setTaskDueDate] = useState<string>('')
  const [taskSteps, setTaskSteps] = useState<StepDraft[]>([])

  const resetTaskForm = useCallback(() => {
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus('BACKLOG')
    setTaskPriority('MEDIUM')
    setTaskTag('')
    setTaskAgentId('')
    setTaskNotes('')
    setTaskRuntimeOverride('')
    setTaskDueDate('')
    setTaskSteps([])
    setEditingTask(null)
  }, [])

  const openEditTaskDialog = useCallback((task: Task) => {
    setEditingTask(task)
    setTaskTitle(task.title)
    setTaskDescription(task.description || '')
    setTaskStatus(task.status)
    setTaskPriority(task.priority)
    setTaskTag(task.tag || '')
    setTaskAgentId(task.agent?.id || '')
    setTaskNotes(task.notes || '')
    setTaskRuntimeOverride(task.runtimeOverride || '')
    // Due date is stored end-of-day UTC; slice the date part so the native
    // input shows exactly the picked calendar day regardless of local TZ.
    setTaskDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '')
    setTaskSteps(
      (task.steps ?? []).map(s => ({
        mode: s.mode,
        agentId: s.agentId,
        humanLabel: s.humanLabel ?? undefined,
        autoContinue: s.autoContinue,
      }))
    )
    setTaskDialogOpen(true)
  }, [])

  const openNewTaskDialog = useCallback((status: TaskStatus = 'BACKLOG') => {
    resetTaskForm()
    setTaskStatus(status)
    setTaskDialogOpen(true)
  }, [resetTaskForm])

  const openNewChainDialog = useCallback(() => {
    resetTaskForm()
    setTaskStatus('BACKLOG')
    setChainDialogOpen(true)
  }, [resetTaskForm])

  const handleSaveTask = useCallback(async () => {
    if (!taskTitle.trim() || !currentProject) return

    // Date-only picker → end-of-day UTC instant, so a task isn't "overdue" at
    // 00:00 on its due date. '' clears the due date (null on update).
    const dueDateIso = taskDueDate ? `${taskDueDate}T23:59:59.999Z` : null

    try {
      if (editingTask) {
        const updatedTask = await tasksApi.update(
          editingTask.id,
          {
            title: taskTitle,
            description: taskDescription,
            status: taskStatus,
            priority: taskPriority,
            tag: taskTag || undefined,
            agentId: taskAgentId || null,
            notes: taskNotes || undefined,
            dueDate: dueDateIso,
            runtimeOverride: taskRuntimeOverride && taskRuntimeOverride !== 'none' ? taskRuntimeOverride : null,
          },
          { errorFallback: 'Failed to update task' },
        )
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
        } : null)
      } else {
        const newTask = await tasksApi.create(
          {
            title: taskTitle,
            description: taskDescription,
            status: taskStatus,
            priority: taskPriority,
            tag: taskTag || undefined,
            agentId: taskAgentId || undefined,
            notes: taskNotes || undefined,
            dueDate: dueDateIso ?? undefined,
            runtimeOverride: taskRuntimeOverride || undefined,
            projectId: currentProject.id,
            steps: taskSteps.length > 0 ? taskSteps : undefined,
          },
          { errorFallback: 'Failed to create task' },
        )
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: [...prev.tasks, newTask],
        } : null)
      }

      resetTaskForm()
      setTaskDialogOpen(false)
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error saving task:', error)
      toast({ title: 'Failed to save task', variant: 'destructive' })
    }
  }, [
    taskTitle, taskDescription, taskStatus, taskPriority, taskTag, taskAgentId,
    taskNotes, taskRuntimeOverride, taskDueDate, taskSteps, currentProject, editingTask,
    setCurrentProject, resetTaskForm, toast,
  ])

  const handleCreateChain = useCallback(async () => {
    if (!currentProject || !taskTitle.trim() || taskSteps.length === 0) return

    try {
      const newTask = await tasksApi.create(
        {
          title: taskTitle,
          description: taskDescription || undefined,
          status: 'BACKLOG',
          priority: taskPriority,
          projectId: currentProject.id,
          steps: taskSteps,
        },
        { errorFallback: 'Failed to create chain' },
      )
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: [...prev.tasks, newTask],
      } : null)
      resetTaskForm()
      setChainDialogOpen(false)
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error creating chain:', error)
      toast({ title: 'Failed to create chain', variant: 'destructive' })
    }
  }, [currentProject, taskTitle, taskDescription, taskPriority, taskSteps, setCurrentProject, resetTaskForm, toast])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    // Permanent — steps, executions, and artifacts go with the task.
    if (!window.confirm('Delete this task? Its steps, executions, and artifacts are removed too.')) return
    try {
      await tasksApi.delete(taskId, { errorFallback: 'Failed to delete task' })
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.filter(t => t.id !== taskId),
      } : null)
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error deleting task:', error)
      toast({ title: 'Failed to delete task', variant: 'destructive' })
    }
  }, [setCurrentProject, toast])

  const handleDragStart = useCallback((task: Task) => {
    setDraggedTask(task)
  }, [])

  // Retained for the TaskActions context shape (E-3). Native HTML5 drag is
  // gone (E-4 uses dnd-kit), so nothing calls this anymore; dnd-kit manages
  // its own drag-over collision detection internally.
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  /**
   * Core status-change path shared by the native-drop shim (handleDrop) and
   * the dnd-kit end handler. Optimistically applies the status locally, then
   * reconciles with the server's authoritative task; rolls back + toasts on
   * failure. C-2's optimistic-move guarantee lives here.
   */
  const moveTaskToStatus = useCallback(async (task: Task, status: TaskStatus) => {
    if (task.status === status) return

    // Optimistic move: snapshot the task, apply the status locally, roll back on failure.
    setCurrentProject(prev => prev ? {
      ...prev,
      tasks: prev.tasks.map(t => t.id === task.id ? { ...t, status } : t),
    } : null)
    const rollback = () => setCurrentProject(prev => prev ? {
      ...prev,
      tasks: prev.tasks.map(t => t.id === task.id ? task : t),
    } : null)

    try {
      const updatedTask = await tasksApi.update(task.id, { status }, { errorFallback: 'Failed to update task status' })
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
      } : null)
    } catch (error) {
      if (error instanceof ApiClientError) {
        rollback()
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error updating task status:', error)
      rollback()
      toast({ title: 'Failed to update task status', variant: 'destructive' })
    }
  }, [setCurrentProject, toast])

  const handleDrop = useCallback(async (status: TaskStatus) => {
    const movedTask = draggedTask
    setDraggedTask(null)
    if (!movedTask) return
    await moveTaskToStatus(movedTask, status)
  }, [draggedTask, moveTaskToStatus])

  // ---- D-3: bulk operations (multi-select move / archive / delete + undo) ----

  const notifyError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiClientError) {
      toast({ title: error.message, variant: 'destructive' })
      return
    }
    console.error(fallback, error)
    toast({ title: fallback, variant: 'destructive' })
  }, [toast])

  /**
   * Bulk move selected tasks to `status` in a single batch call. Optimistically
   * restatuses locally, reconciles with the server's returned tasks, and offers
   * an Undo that re-applies each task's prior status (grouped into one batch
   * call per distinct prior status).
   */
  const bulkMoveTasks = useCallback(async (taskIds: string[], status: TaskStatus) => {
    if (!currentProject || taskIds.length === 0) return
    const idSet = new Set(taskIds)
    const snapshot = currentProject.tasks.filter((t) => idSet.has(t.id))
    // Snapshot each task's prior status so Undo can restore it exactly.
    const priorStatus = new Map(snapshot.map((t) => [t.id, t.status]))

    setCurrentProject((prev) => prev ? {
      ...prev,
      tasks: prev.tasks.map((t) => idSet.has(t.id) ? { ...t, status } : t),
    } : null)

    try {
      const res = await tasksApi.batch({ action: 'move', taskIds, status }, { errorFallback: 'Failed to move tasks' })
      if (res.tasks.length > 0) {
        const byId = new Map(res.tasks.map((t) => [t.id, t]))
        setCurrentProject((prev) => prev ? {
          ...prev,
          tasks: prev.tasks.map((t) => byId.get(t.id) ?? t),
        } : null)
      }
      const moved = res.affected.length
      if (moved === 0) return

      const undo = async () => {
        const byStatus = new Map<TaskStatus, string[]>()
        for (const id of res.affected) {
          const prior = priorStatus.get(id)
          if (!prior) continue
          byStatus.set(prior, [...(byStatus.get(prior) ?? []), id])
        }
        setCurrentProject((prev) => prev ? {
          ...prev,
          tasks: prev.tasks.map((t) => priorStatus.has(t.id) ? { ...t, status: priorStatus.get(t.id)! } : t),
        } : null)
        try {
          await Promise.all(
            [...byStatus].map(([prior, ids]) => tasksApi.batch({ action: 'move', taskIds: ids, status: prior })),
          )
        } catch (error) {
          notifyError(error, 'Failed to undo move')
        }
      }

      toast({
        title: `Moved ${moved} task${moved === 1 ? '' : 's'}`,
        action: createElement(ToastAction, { altText: 'Undo move', onClick: () => void undo() }, 'Undo') as unknown as ToastActionElement,
      })
    } catch (error) {
      // Roll the whole selection back to its snapshot.
      setCurrentProject((prev) => prev ? {
        ...prev,
        tasks: prev.tasks.map((t) => snapshot.find((s) => s.id === t.id) ?? t),
      } : null)
      notifyError(error, 'Failed to move tasks')
    }
  }, [currentProject, setCurrentProject, toast, notifyError])

  /**
   * Bulk archive/delete: optimistically drop the tasks off the board, batch the
   * mutation, and offer an Undo that restores them via the per-task
   * unarchive/restore routes. `action` picks archive vs soft-delete.
   */
  const bulkRemoveTasks = useCallback(async (taskIds: string[], action: 'archive' | 'delete') => {
    if (!currentProject || taskIds.length === 0) return
    const idSet = new Set(taskIds)
    // Board only holds live tasks, so the snapshot is exactly the set we remove.
    const snapshot = currentProject.tasks.filter((t) => idSet.has(t.id))
    if (snapshot.length === 0) return

    setCurrentProject((prev) => prev ? {
      ...prev,
      tasks: prev.tasks.filter((t) => !idSet.has(t.id)),
    } : null)

    const verb = action === 'delete' ? 'Deleted' : 'Archived'
    const restoreFallback = `Failed to undo ${action}`

    try {
      const res = await tasksApi.batch({ action, taskIds }, { errorFallback: `Failed to ${action} tasks` })
      const count = res.affected.length || snapshot.length

      const undo = async () => {
        setCurrentProject((prev) => prev ? { ...prev, tasks: mergeBackTasks(prev.tasks, snapshot) } : null)
        try {
          await Promise.all(
            snapshot.map((t) => action === 'delete' ? tasksApi.restore(t.id) : tasksApi.unarchive(t.id)),
          )
        } catch (error) {
          notifyError(error, restoreFallback)
        }
      }

      toast({
        title: `${verb} ${count} task${count === 1 ? '' : 's'}`,
        action: createElement(ToastAction, { altText: `Undo ${action}`, onClick: () => void undo() }, 'Undo') as unknown as ToastActionElement,
      })
    } catch (error) {
      // Roll back — put the removed tasks back on the board.
      setCurrentProject((prev) => prev ? { ...prev, tasks: mergeBackTasks(prev.tasks, snapshot) } : null)
      notifyError(error, `Failed to ${action} tasks`)
    }
  }, [currentProject, setCurrentProject, toast, notifyError])

  const bulkArchiveTasks = useCallback((taskIds: string[]) => bulkRemoveTasks(taskIds, 'archive'), [bulkRemoveTasks])
  const bulkDeleteTasks = useCallback((taskIds: string[]) => bulkRemoveTasks(taskIds, 'delete'), [bulkRemoveTasks])

  return {
    editingTask,
    taskDialogOpen,
    setTaskDialogOpen,
    chainDialogOpen,
    setChainDialogOpen,
    viewingTaskSteps,
    setViewingTaskSteps,
    selectedTask,
    setSelectedTask,
    mobileColumn,
    setMobileColumn,
    taskTitle,
    setTaskTitle,
    taskDescription,
    setTaskDescription,
    taskStatus,
    setTaskStatus,
    taskPriority,
    setTaskPriority,
    taskTag,
    setTaskTag,
    taskAgentId,
    setTaskAgentId,
    taskNotes,
    setTaskNotes,
    taskRuntimeOverride,
    setTaskRuntimeOverride,
    taskDueDate,
    setTaskDueDate,
    taskSteps,
    setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
    bulkMoveTasks,
    bulkArchiveTasks,
    bulkDeleteTasks,
    openEditTaskDialog,
    openNewTaskDialog,
    openNewChainDialog,
    resetTaskForm,
  }
}
