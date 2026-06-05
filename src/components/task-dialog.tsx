'use client'

import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChainBuilder } from '@/components/chain-builder'
import { AgentBadge } from '@/components/agent-badge'
import type { Task, TaskStatus, TaskPriority, Project } from '@/types/board'
import type { ProjectMode, ChainTemplate, TaskTemplate, StepDraft } from '@/types/settings'

interface TaskDialogProps {
  taskDialogOpen: boolean
  setTaskDialogOpen: Dispatch<SetStateAction<boolean>>
  editingTask: Task | null
  taskTitle: string
  setTaskTitle: Dispatch<SetStateAction<string>>
  taskDescription: string
  setTaskDescription: Dispatch<SetStateAction<string>>
  taskStatus: TaskStatus
  setTaskStatus: Dispatch<SetStateAction<TaskStatus>>
  taskPriority: TaskPriority
  setTaskPriority: Dispatch<SetStateAction<TaskPriority>>
  taskTag: string
  setTaskTag: Dispatch<SetStateAction<string>>
  taskAgentId: string
  setTaskAgentId: Dispatch<SetStateAction<string>>
  taskNotes: string
  setTaskNotes: Dispatch<SetStateAction<string>>
  taskRuntimeOverride: string
  setTaskRuntimeOverride: Dispatch<SetStateAction<string>>
  taskSteps: StepDraft[]
  setTaskSteps: Dispatch<SetStateAction<StepDraft[]>>
  handleSaveTask: () => Promise<void>
  resetTaskForm: () => void
  currentProject: Project | null
  projectModes: ProjectMode[]
  chainTemplates: ChainTemplate[]
  taskTemplates: TaskTemplate[]
  statusColumns: { id: TaskStatus; label: string; color: string }[]
}

export function TaskDialog({
  taskDialogOpen, setTaskDialogOpen, editingTask,
  taskTitle, setTaskTitle, taskDescription, setTaskDescription,
  taskStatus, setTaskStatus, taskPriority, setTaskPriority,
  taskTag, setTaskTag, taskAgentId, setTaskAgentId,
  taskNotes, setTaskNotes, taskRuntimeOverride, setTaskRuntimeOverride,
  taskSteps, setTaskSteps,
  handleSaveTask, resetTaskForm,
  currentProject, projectModes, chainTemplates, taskTemplates, statusColumns,
}: TaskDialogProps) {
  // Task templates (Epic S6): picking one prefills the form. It's a suggestion —
  // every field stays editable, and picking another template overwrites again.
  const [pickedTemplateId, setPickedTemplateId] = useState('')

  const applyTaskTemplate = (templateId: string) => {
    setPickedTemplateId(templateId)
    const template = taskTemplates.find((t) => t.id === templateId)
    if (!template) return
    if (template.titlePattern) {
      const today = new Date().toISOString().slice(0, 10)
      setTaskTitle(template.titlePattern.replaceAll('{date}', today))
    }
    if (template.description != null) setTaskDescription(template.description)
    if (template.priority) setTaskPriority(template.priority as TaskPriority)
    if (template.tag) setTaskTag(template.tag)
    if (template.notes != null) setTaskNotes(template.notes)
    if (template.chainTemplateId) {
      const chain = chainTemplates.find((c) => c.id === template.chainTemplateId)
      if (chain) {
        try {
          const parsed = JSON.parse(chain.steps)
          if (Array.isArray(parsed)) setTaskSteps(parsed)
        } catch {
          // malformed chain steps — leave the builder as-is
        }
      }
    }
  }
  // Project default (Epic S1): fresh task dialogs start with the default
  // chain template's steps prefilled — visible and fully editable, so it's
  // a suggestion rather than a surprise.
  const defaultTemplateId = currentProject?.defaultChainTemplateId
  useEffect(() => {
    if (!taskDialogOpen || editingTask || taskSteps.length > 0 || !defaultTemplateId) return
    const template = chainTemplates.find((t) => t.id === defaultTemplateId)
    if (!template) return
    try {
      const parsed = JSON.parse(template.steps)
      if (Array.isArray(parsed) && parsed.length > 0) setTaskSteps(parsed)
    } catch {
      // malformed template steps — leave the builder empty
    }
  }, [taskDialogOpen, editingTask, defaultTemplateId, taskSteps.length, chainTemplates, setTaskSteps])

  return (
    <Dialog open={taskDialogOpen} onOpenChange={(open) => { setTaskDialogOpen(open); if (!open) { resetTaskForm(); setPickedTemplateId('') } }}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{editingTask ? 'Edit Task' : 'Create New Task'}</DialogTitle>
          <DialogDescription>
            {editingTask ? 'Update the task details below.' : 'Add a new task to your board.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {!editingTask && taskTemplates.length > 0 && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Start from template</label>
              <Select value={pickedTemplateId} onValueChange={applyTaskTemplate}>
                <SelectTrigger><SelectValue placeholder="Blank task" /></SelectTrigger>
                <SelectContent>
                  {taskTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.icon || '📋'} {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <label className="text-sm font-medium">Title</label>
            <Input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Enter task title..."
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="Enter task description..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={taskStatus} onValueChange={(v) => setTaskStatus(v as TaskStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusColumns.map((col) => (
                    <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Priority</label>
              <Select value={taskPriority} onValueChange={(v) => setTaskPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Tag</label>
              <Select value={taskTag} onValueChange={setTaskTag}>
                <SelectTrigger><SelectValue placeholder="Select tag..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="research">research</SelectItem>
                  <SelectItem value="docs">docs</SelectItem>
                  <SelectItem value="backend">backend</SelectItem>
                  <SelectItem value="frontend">frontend</SelectItem>
                  <SelectItem value="devops">devops</SelectItem>
                  <SelectItem value="copy">copy</SelectItem>
                  <SelectItem value="design">design</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Agent</label>
              <Select value={taskAgentId} onValueChange={setTaskAgentId}>
                <SelectTrigger><SelectValue placeholder="Assign agent..." /></SelectTrigger>
                <SelectContent>
                  {currentProject?.agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <AgentBadge agent={agent} size="card" />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Runtime Override</label>
            <Select value={taskRuntimeOverride} onValueChange={setTaskRuntimeOverride}>
              <SelectTrigger><SelectValue placeholder="Use agent default" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Use agent default</SelectItem>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                {/* GitHub Copilot is registered as an unavailable adapter (adapters/registry.ts:25). Add back once the adapter lands. */}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Override the runtime for this specific task (daemon mode only).</p>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              value={taskNotes}
              onChange={(e) => setTaskNotes(e.target.value)}
              placeholder="Progress notes, status updates..."
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Workflow Chain</label>
            <ChainBuilder
              projectId={currentProject?.id || ''}
              agents={currentProject?.agents || []}
              modes={projectModes}
              templates={chainTemplates}
              steps={taskSteps}
              onStepsChange={setTaskSteps}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setTaskDialogOpen(false); resetTaskForm(); setPickedTemplateId('') }}>
            Cancel
          </Button>
          <Button onClick={handleSaveTask}>
            {editingTask ? 'Save Changes' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
