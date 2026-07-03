'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
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

  const readApiError = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = await response.json()
      return payload?.error || fallback
    } catch {
      return fallback
    }
  }, [])

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
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription,
            status: taskStatus,
            priority: taskPriority,
            tag: taskTag || undefined,
            agentId: taskAgentId || null,
            notes: taskNotes || undefined,
            runtimeOverride: taskRuntimeOverride && taskRuntimeOverride !== 'none' ? taskRuntimeOverride : null,
          }),
        })
        if (!res.ok) {
          toast({ title: await readApiError(res, 'Failed to update task'), variant: 'destructive' })
          return
        }
        const updatedTask = await res.json()
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
        } : null)
      } else {
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        })
        if (!res.ok) {
          toast({ title: await readApiError(res, 'Failed to create task'), variant: 'destructive' })
          return
        }
        const newTask = await res.json()
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: [...prev.tasks, newTask],
        } : null)
      }

      resetTaskForm()
      setTaskDialogOpen(false)
    } catch (error) {
      console.error('Error saving task:', error)
      toast({ title: 'Failed to save task', variant: 'destructive' })
    }
  }, [
    taskTitle, taskDescription, taskStatus, taskPriority, taskTag, taskAgentId,
    taskNotes, taskRuntimeOverride, taskSteps, currentProject, editingTask,
    setCurrentProject, readApiError, resetTaskForm, toast,
  ])

  const handleCreateChain = useCallback(async () => {
    if (!currentProject || !taskTitle.trim() || taskSteps.length === 0) return

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription || undefined,
          status: 'BACKLOG',
          priority: taskPriority,
          projectId: currentProject.id,
          steps: taskSteps,
        }),
      })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to create chain'), variant: 'destructive' })
        return
      }
      const newTask = await res.json()
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: [...prev.tasks, newTask],
      } : null)
      resetTaskForm()
      setChainDialogOpen(false)
    } catch (error) {
      console.error('Error creating chain:', error)
      toast({ title: 'Failed to create chain', variant: 'destructive' })
    }
  }, [currentProject, taskTitle, taskDescription, taskPriority, taskSteps, setCurrentProject, readApiError, resetTaskForm, toast])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    // Permanent — steps, executions, and artifacts go with the task.
    if (!window.confirm('Delete this task? Its steps, executions, and artifacts are removed too.')) return
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to delete task'), variant: 'destructive' })
        return
      }
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.filter(t => t.id !== taskId),
      } : null)
    } catch (error) {
      console.error('Error deleting task:', error)
      toast({ title: 'Failed to delete task', variant: 'destructive' })
    }
  }, [setCurrentProject, readApiError, toast])

  const handleDragStart = useCallback((task: Task) => {
    setDraggedTask(task)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (status: TaskStatus) => {
    if (!draggedTask || draggedTask.status === status) {
      setDraggedTask(null)
      return
    }

    // Optimistic move: snapshot the dragged task, apply the status locally, roll back on failure.
    const movedTask = draggedTask
    setDraggedTask(null)
    setCurrentProject(prev => prev ? {
      ...prev,
      tasks: prev.tasks.map(t => t.id === movedTask.id ? { ...t, status } : t),
    } : null)
    const rollback = () => setCurrentProject(prev => prev ? {
      ...prev,
      tasks: prev.tasks.map(t => t.id === movedTask.id ? movedTask : t),
    } : null)

    try {
      const res = await fetch(`/api/tasks/${movedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        rollback()
        toast({ title: await readApiError(res, 'Failed to update task status'), variant: 'destructive' })
        return
      }
      const updatedTask = await res.json()
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
      } : null)
    } catch (error) {
      console.error('Error updating task status:', error)
      rollback()
      toast({ title: 'Failed to update task status', variant: 'destructive' })
    }
  }, [draggedTask, setCurrentProject, readApiError, toast])

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
