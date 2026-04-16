'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Plus, Building2 } from 'lucide-react'

interface Workspace {
  id: string
  slug: string
  name: string
  _count: { projects: number; daemons: number }
}

interface WorkspaceSwitcherProps {
  currentWorkspaceId?: string | null
  onSwitch: (workspaceId: string) => void
  onCreate?: () => void
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

export function WorkspaceSwitcher({ currentWorkspaceId, onSwitch }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkspaces = useCallback(() => {
    fetch('/api/workspaces')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.data) setWorkspaces(data.data)
      })
      .catch(() => {})
  }, [])

  useEffect(() => { fetchWorkspaces() }, [fetchWorkspaces])

  const current = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0]

  const handleNameChange = (name: string) => {
    setNewName(name)
    if (!slugTouched) setNewSlug(slugify(name))
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim() }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to create workspace' }))
        setError(body.error || 'Failed to create workspace')
        setSaving(false)
        return
      }

      const workspace = await res.json()
      fetchWorkspaces()
      onSwitch(workspace.id)
      setDialogOpen(false)
      setNewName('')
      setNewSlug('')
      setSlugTouched(false)
    } catch {
      setError('Network error')
    }
    setSaving(false)
  }

  if (workspaces.length === 0) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-medium">
            <Building2 className="w-3.5 h-3.5" />
            {current?.name || 'Workspace'}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.id}
              className={ws.id === current?.id ? 'bg-accent' : ''}
              onClick={() => onSwitch(ws.id)}
            >
              <div className="flex flex-col">
                <span className="font-medium">{ws.name}</span>
                <span className="text-xs text-muted-foreground">
                  {ws._count.projects} project{ws._count.projects !== 1 ? 's' : ''}
                  {ws._count.daemons > 0 && ` · ${ws._count.daemons} daemon${ws._count.daemons !== 1 ? 's' : ''}`}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDialogOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-2" />
            New Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setError(null); setNewName(''); setNewSlug(''); setSlugTouched(false) } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              Workspaces isolate projects, agents, and daemons.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={newName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="My Team"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Slug</label>
              <Input
                value={newSlug}
                onChange={(e) => { setNewSlug(e.target.value); setSlugTouched(true) }}
                placeholder="my-team"
              />
              <p className="text-xs text-muted-foreground">Lowercase, alphanumeric, dashes only.</p>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim() || !newSlug.trim()}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
