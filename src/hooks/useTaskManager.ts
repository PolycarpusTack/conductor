'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { ApiClientError } from '@/lib/api/client'
import { tasksApi } from '@/lib/api/endpoints'
import type { Task, TaskStatus, TaskPriority, TaskStepSummary, Project } from '@/types/board'
import type { StepDraft } from '@/types/settings'

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
    taskNotes, taskRuntimeOverride, taskSteps, currentProject, editingTask,
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
    taskSteps,
    setTaskSteps,
    handleSaveTask,
    handleCreateChain,
    handleDeleteTask,
    handleDragStart,
    handleDragOver,
    handleDrop,
    openEditTaskDialog,
    openNewTaskDialog,
    openNewChainDialog,
    resetTaskForm,
  }
}
