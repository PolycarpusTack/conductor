'use client'

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
import type { TaskPriority } from '@/types/board'
import { useProjectDataCtx, useTaskActions } from '@/app/_views/board-context'

export function ChainDialog() {
  const { currentProject, projectModes, chainTemplates } = useProjectDataCtx()
  const {
    chainDialogOpen, setChainDialogOpen,
    taskTitle, setTaskTitle, taskDescription, setTaskDescription,
    taskPriority, setTaskPriority, taskSteps, setTaskSteps,
    handleCreateChain, resetTaskForm,
  } = useTaskActions()
  return (
    <Dialog open={chainDialogOpen} onOpenChange={(open) => { setChainDialogOpen(open); if (!open) resetTaskForm() }}>
      <DialogContent className="sm:max-w-[780px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Create Chain Task</DialogTitle>
          <DialogDescription>
            Select a template or build a custom workflow chain, then create a task that runs through it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1">
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Task Title</label>
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="What should this chain accomplish?"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Context and requirements for the chain..."
                rows={2}
              />
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

            <div className="grid gap-2">
              <label className="text-sm font-medium">Workflow</label>
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
        </div>

        <DialogFooter className="shrink-0 border-t pt-4">
          <Button variant="outline" onClick={() => { setChainDialogOpen(false); resetTaskForm() }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateChain}
            disabled={!taskTitle.trim() || taskSteps.length === 0}
          >
            Create Chain Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
