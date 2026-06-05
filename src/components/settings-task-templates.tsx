'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Pencil, Plus } from 'lucide-react'
import type { TaskTemplate, ChainTemplate } from '@/types/settings'

interface SettingsTaskTemplatesProps {
  projectId: string
  templates: TaskTemplate[]
  chainTemplates: ChainTemplate[]
  onTemplatesChange: (templates: TaskTemplate[]) => void
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

export function SettingsTaskTemplates({ projectId, templates, chainTemplates, onTemplatesChange }: SettingsTaskTemplatesProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [titlePattern, setTitlePattern] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('')
  const [tag, setTag] = useState('')
  const [notes, setNotes] = useState('')
  const [chainTemplateId, setChainTemplateId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setIcon('')
    setTitlePattern('')
    setDescription('')
    setPriority('')
    setTag('')
    setNotes('')
    setChainTemplateId('')
    setError(null)
  }

  const startEdit = (template: TaskTemplate) => {
    setEditing(template.id)
    setName(template.name)
    setIcon(template.icon || '')
    setTitlePattern(template.titlePattern || '')
    setDescription(template.description || '')
    setPriority(template.priority || '')
    setTag(template.tag || '')
    setNotes(template.notes || '')
    setChainTemplateId(template.chainTemplateId || '')
    setCreating(false)
  }

  const handleSave = async () => {
    setError(null)
    // Blank optional fields are sent as null so PUT clears previously-set values.
    const payload = {
      name,
      icon: icon || undefined,
      titlePattern: titlePattern || null,
      description: description || null,
      priority: priority || null,
      tag: tag || null,
      notes: notes || null,
      chainTemplateId: chainTemplateId && chainTemplateId !== 'none' ? chainTemplateId : null,
    }
    try {
      if (editing) {
        const res = await fetch(`/api/projects/${projectId}/task-templates/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update task template')
        const updated = await res.json()
        onTemplatesChange(templates.map(t => t.id === editing ? updated : t))
      } else {
        const res = await fetch(`/api/projects/${projectId}/task-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to create task template')
        const created = await res.json()
        onTemplatesChange([...templates, created])
      }
      setEditing(null)
      setCreating(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleDelete = async (templateId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/task-templates/${templateId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onTemplatesChange(templates.filter(t => t.id !== templateId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const chainName = (id: string | null | undefined) =>
    chainTemplates.find(c => c.id === id)?.name

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {templates.map((template) => (
        <div key={template.id} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-card/50">
          <div className="flex items-center gap-3">
            <span className="text-lg">{template.icon || '📋'}</span>
            <div>
              <div className="text-sm font-medium">{template.name}</div>
              <div className="text-xs text-muted-foreground">
                {[
                  template.titlePattern && `"${template.titlePattern}"`,
                  template.priority,
                  template.tag,
                  chainName(template.chainTemplateId) && `⛓ ${chainName(template.chainTemplateId)}`,
                ].filter(Boolean).join(' · ') || 'No defaults set'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => startEdit(template)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(template.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {(creating || editing) ? (
        <div className="p-4 rounded-lg border border-border/30 bg-card/30 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground">Template Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Bug report" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Icon</label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🐛" className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title pattern</label>
            <Input value={titlePattern} onChange={e => setTitlePattern(e.target.value)}
              placeholder="Bug: … ({date} expands to today)" className="mt-1" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Prefilled task description..." rows={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority || 'none'} onValueChange={v => setPriority(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1 text-xs h-9"><SelectValue placeholder="No default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No default</SelectItem>
                  {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tag</label>
              <Input value={tag} onChange={e => setTag(e.target.value)} placeholder="backend" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Attached chain</label>
              <Select value={chainTemplateId || 'none'} onValueChange={v => setChainTemplateId(v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1 text-xs h-9"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {chainTemplates.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Prefilled notes..." rows={2} className="mt-1" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setCreating(false); resetForm() }}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!name.trim()}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => { resetForm(); setCreating(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Task Template
        </Button>
      )}
    </div>
  )
}
