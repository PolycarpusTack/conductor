'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useProjectDataCtx } from '@/app/_views/board-context'

export function ProjectDialog() {
  const {
    projectDialogOpen, setProjectDialogOpen,
    projectName, setProjectName,
    projectDescription, setProjectDescription,
    projectColor, setProjectColor,
    createStarterAgents, setCreateStarterAgents,
    handleCreateProject, resetProjectForm,
  } = useProjectDataCtx()
  return (
    <Dialog
      open={projectDialogOpen}
      onOpenChange={(open) => {
        setProjectDialogOpen(open)
        if (!open) resetProjectForm()
      }}
    >
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Create a new project to organize your agents and tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Project Name</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="My Project"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Brief description..."
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Color</label>
            <div className="flex gap-2">
              {['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'].map((color) => (
                <button
                  key={color}
                  onClick={() => setProjectColor(color)}
                  className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-background ${projectColor === color ? 'ring-foreground' : 'ring-transparent'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border/30 p-3">
            <Checkbox
              id="create-starter-agents"
              checked={createStarterAgents}
              onCheckedChange={(checked) => setCreateStarterAgents(checked === true)}
            />
            <div className="grid gap-1">
              <label htmlFor="create-starter-agents" className="text-sm font-medium">
                Add starter agents
              </label>
              <p className="text-xs text-muted-foreground">
                Pre-create Coder, Research, Writer, and QA agents for faster onboarding.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateProject}>Create Project</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
