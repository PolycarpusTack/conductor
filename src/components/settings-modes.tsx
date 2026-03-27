'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Trash2, Pencil, Plus } from 'lucide-react'

interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
  icon?: string | null
  instructions?: string | null
}

interface SettingsModesProps {
  projectId: string
  modes: ProjectMode[]
  onModesChange: (modes: ProjectMode[]) => void
}

export function SettingsModes({ projectId, modes, onModesChange }: SettingsModesProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#60A5FA')
  const [icon, setIcon] = useState('')
  const [instructions, setInstructions] = useState('')
  const [error, setError] = useState<string | null>(null)

  const colors = ['#60A5FA', '#F59E0B', '#4ADE80', '#2DD4BF', '#A78BFA', '#F87171', '#9BAAC4']

  const resetForm = () => {
    setName('')
    setLabel('')
    setColor('#60A5FA')
    setIcon('')
    setInstructions('')
    setError(null)
  }

  const startEdit = (mode: ProjectMode) => {
    setEditing(mode.id)
    setName(mode.name)
    setLabel(mode.label)
    setColor(mode.color)
    setIcon(mode.icon || '')
    setInstructions(mode.instructions || '')
    setCreating(false)
  }

  const handleSave = async () => {
    setError(null)
    try {
      if (editing) {
        const res = await fetch(`/api/projects/${projectId}/modes/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, label, color, icon: icon || undefined, instructions: instructions || undefined }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update mode')
        const updated = await res.json()
        onModesChange(modes.map(m => m.id === editing ? updated : m))
      } else {
        const res = await fetch(`/api/projects/${projectId}/modes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, label, color, icon: icon || undefined, instructions: instructions || undefined }),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to create mode')
        const created = await res.json()
        onModesChange([...modes, created])
      }
      setEditing(null)
      setCreating(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleDelete = async (modeId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/modes/${modeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onModesChange(modes.filter(m => m.id !== modeId))
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

      {modes.map((mode) => (
        <div key={mode.id} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-card/50">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: mode.color }} />
            <span className="text-sm">{mode.icon}</span>
            <div>
              <div className="text-sm font-medium">{mode.label}</div>
              <div className="text-xs text-muted-foreground font-mono">{mode.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => startEdit(mode)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(mode.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {(creating || editing) ? (
        <div className="p-4 rounded-lg border border-border/30 bg-card/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name (key)</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="analyze" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Label</label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Analyze" className="mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Icon</label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🔍" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Color</label>
              <div className="flex gap-2 mt-2">
                {colors.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full ring-2 ring-offset-1 ring-offset-background ${color === c ? 'ring-foreground' : 'ring-transparent'}`}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Default Instructions</label>
            <Textarea value={instructions} onChange={e => setInstructions(e.target.value)}
              placeholder="Instructions injected when this mode is used..." rows={2} className="mt-1" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setCreating(false); resetForm() }}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => { resetForm(); setCreating(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Mode
        </Button>
      )}
    </div>
  )
}
