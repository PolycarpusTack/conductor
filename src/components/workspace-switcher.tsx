'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
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
  onCreate: () => void
}

export function WorkspaceSwitcher({ currentWorkspaceId, onSwitch, onCreate }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  useEffect(() => {
    fetch('/api/workspaces')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.data) setWorkspaces(data.data)
      })
      .catch(() => {})
  }, [])

  const current = workspaces.find((w) => w.id === currentWorkspaceId) || workspaces[0]

  if (workspaces.length === 0) return null

  return (
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
        <DropdownMenuItem onClick={onCreate}>
          <Plus className="w-3.5 h-3.5 mr-2" />
          New Workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
