'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Pencil, Plus } from 'lucide-react'

interface McpConnection {
  id: string
  name: string
  type: string
  icon?: string | null
  endpoint?: string | null
}

interface SettingsMcpProps {
  projectId: string
  connections: McpConnection[]
  onConnectionsChange: (connections: McpConnection[]) => void
}

const TYPE_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'jira', label: 'Jira' },
  { value: 'slack', label: 'Slack' },
  { value: 'confluence', label: 'Confluence' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'custom', label: 'Custom' },
]

const TYPE_ICONS: Record<string, string> = {
  github: '🐙',
  jira: '📋',
  slack: '💬',
  confluence: '📄',
  postgres: '🐘',
  custom: '🔌',
}

export function SettingsMcp({ projectId, connections, onConnectionsChange }: SettingsMcpProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('github')
  const [icon, setIcon] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setType('github')
    setIcon('')
    setEndpoint('')
    setError(null)
  }

  const startEdit = (conn: McpConnection) => {
    setEditing(conn.id)
    setName(conn.name)
    setType(conn.type)
    setIcon(conn.icon || '')
    setEndpoint(conn.endpoint || '')
    setCreating(false)
  }

  const handleSave = async () => {
    setError(null)
    try {
      const payload = {
        name,
        type,
        icon: icon || TYPE_ICONS[type] || undefined,
        endpoint: endpoint || undefined,
      }

      if (editing) {
        const res = await fetch(`/api/projects/${projectId}/mcp-connections/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update connection')
        const updated = await res.json()
        onConnectionsChange(connections.map(c => c.id === editing ? updated : c))
      } else {
        const res = await fetch(`/api/projects/${projectId}/mcp-connections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to create connection')
        const created = await res.json()
        onConnectionsChange([...connections, created])
      }
      setEditing(null)
      setCreating(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleDelete = async (connId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/mcp-connections/${connId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onConnectionsChange(connections.filter(c => c.id !== connId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {connections.map((conn) => (
        <div key={conn.id} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-card/50">
          <div className="flex items-center gap-3">
            <span className="text-sm">{conn.icon || TYPE_ICONS[conn.type] || '🔌'}</span>
            <div>
              <div className="text-sm font-medium">{conn.name}</div>
              <div className="text-xs text-muted-foreground">{conn.type}{conn.endpoint ? ` · ${conn.endpoint}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => startEdit(conn)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(conn.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {(creating || editing) ? (
        <div className="p-4 rounded-lg border border-border/30 bg-card/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {TYPE_ICONS[opt.value]} {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="My GitHub" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Icon (optional)</label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder={TYPE_ICONS[type] || '🔌'} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
              <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://..." className="mt-1" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setCreating(false); resetForm() }}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => { resetForm(); setCreating(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Connection
        </Button>
      )}
    </div>
  )
}
