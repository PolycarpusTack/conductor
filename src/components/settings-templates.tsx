'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, Pencil, Plus, X } from 'lucide-react'

interface TemplateStep {
  agentRole?: string
  humanLabel?: string
  mode: string
  instructions?: string
  autoContinue: boolean
}

interface ChainTemplate {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  steps: unknown
}

interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
  icon?: string | null
}

interface SettingsTemplatesProps {
  projectId: string
  templates: ChainTemplate[]
  modes?: ProjectMode[]
  onTemplatesChange: (templates: ChainTemplate[]) => void
}

const ROLE_OPTIONS = ['developer', 'researcher', 'writer', 'support', 'qa', 'analyst']

function parseSteps(steps: unknown): TemplateStep[] {
  if (Array.isArray(steps)) return steps
  if (typeof steps === 'string') {
    try { return JSON.parse(steps) } catch { return [] }
  }
  return []
}

function getStepCount(steps: unknown): number {
  return parseSteps(steps).length
}

function getHumanGateCount(steps: unknown): number {
  return parseSteps(steps).filter(s => s.mode === 'human' || s.humanLabel).length
}

export function SettingsTemplates({ projectId, templates, modes = [], onTemplatesChange }: SettingsTemplatesProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [steps, setSteps] = useState<TemplateStep[]>([])
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setDescription('')
    setIcon('')
    setSteps([])
    setError(null)
  }

  const startEdit = (template: ChainTemplate) => {
    setEditing(template.id)
    setName(template.name)
    setDescription(template.description || '')
    setIcon(template.icon || '')
    setSteps(parseSteps(template.steps))
    setCreating(false)
  }

  const addStep = () => {
    setSteps(prev => [...prev, { mode: modes[0]?.name || 'analyze', autoContinue: true }])
  }

  const removeStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index))
  }

  const updateStep = (index: number, updates: Partial<TemplateStep>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s))
  }

  const toggleHuman = (index: number) => {
    const step = steps[index]
    if (step.humanLabel !== undefined || step.mode === 'human') {
      updateStep(index, { humanLabel: undefined, mode: modes[0]?.name || 'analyze', agentRole: 'developer', autoContinue: true })
    } else {
      updateStep(index, { humanLabel: 'Reviewer', agentRole: undefined, mode: 'human', autoContinue: false })
    }
  }

  const handleSave = async () => {
    setError(null)

    if (steps.length === 0) {
      setError('Add at least one step')
      return
    }

    try {
      const payload = {
        name,
        description: description || undefined,
        icon: icon || undefined,
        projectId,
        steps,
      }

      if (editing) {
        const res = await fetch(`/api/projects/${projectId}/chain-templates/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update template')
        const updated = await res.json()
        onTemplatesChange(templates.map(t => t.id === editing ? updated : t))
      } else {
        const res = await fetch(`/api/projects/${projectId}/chain-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to create template')
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
      const res = await fetch(`/api/projects/${projectId}/chain-templates/${templateId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onTemplatesChange(templates.filter(t => t.id !== templateId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const isHumanStep = (step: TemplateStep) => step.mode === 'human' || !!step.humanLabel

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
            <span className="text-lg">{template.icon || '🔗'}</span>
            <div>
              <div className="text-sm font-medium">{template.name}</div>
              <div className="text-xs text-muted-foreground">
                {getStepCount(template.steps)} step{getStepCount(template.steps) !== 1 ? 's' : ''}
                {getHumanGateCount(template.steps) > 0 && ` · ${getHumanGateCount(template.steps)} human gate${getHumanGateCount(template.steps) !== 1 ? 's' : ''}`}
                {template.description && ` · ${template.description}`}
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
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Support Investigation" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Icon</label>
              <Input value={icon} onChange={e => setIcon(e.target.value)} placeholder="🛡️" className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Analyze → verify → review → fix → approve" className="mt-1" />
          </div>

          {/* Step builder */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Workflow Steps</label>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center gap-2 p-2 rounded-md border border-border/20 bg-background/50">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold font-mono bg-muted text-muted-foreground flex-shrink-0">
                    {index + 1}
                  </div>

                  {isHumanStep(step) ? (
                    <>
                      <div className="text-xs px-2 py-1 rounded bg-[var(--op-purple-bg,rgba(167,139,250,0.1))] text-[var(--op-purple,#A78BFA)] border border-[var(--op-purple-dim,rgba(167,139,250,0.2))] font-mono">
                        human
                      </div>
                      <Input
                        value={step.humanLabel || ''}
                        onChange={e => updateStep(index, { humanLabel: e.target.value })}
                        placeholder="Reviewer"
                        className="flex-1 text-xs h-8"
                      />
                    </>
                  ) : (
                    <>
                      <Select value={step.mode} onValueChange={v => updateStep(index, { mode: v })}>
                        <SelectTrigger className="w-[110px] text-xs h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {modes.filter(m => m.name !== 'human').map(m => (
                            <SelectItem key={m.name} value={m.name}>
                              {m.icon} {m.label}
                            </SelectItem>
                          ))}
                          {modes.length === 0 && (
                            <>
                              <SelectItem value="analyze">Analyze</SelectItem>
                              <SelectItem value="verify">Verify</SelectItem>
                              <SelectItem value="develop">Develop</SelectItem>
                              <SelectItem value="review">Review</SelectItem>
                              <SelectItem value="draft">Draft</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      <Select value={step.agentRole || ''} onValueChange={v => updateStep(index, { agentRole: v })}>
                        <SelectTrigger className="w-[110px] text-xs h-8">
                          <SelectValue placeholder="Agent role" />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map(r => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}

                  <button
                    onClick={() => toggleHuman(index)}
                    className={`text-[10px] font-mono px-2 py-1 rounded border flex-shrink-0 ${
                      isHumanStep(step)
                        ? 'bg-[var(--op-purple-bg,rgba(167,139,250,0.1))] text-[var(--op-purple,#A78BFA)] border-[var(--op-purple-dim,rgba(167,139,250,0.2))]'
                        : 'bg-transparent text-muted-foreground border-border/30 hover:border-border'
                    }`}
                  >
                    👤
                  </button>

                  <button
                    onClick={() => updateStep(index, { autoContinue: !step.autoContinue })}
                    className={`text-[10px] font-mono px-2 py-1 rounded border flex-shrink-0 ${
                      step.autoContinue
                        ? 'bg-[var(--op-green-bg,rgba(74,222,128,0.1))] text-[var(--op-green,#4ADE80)] border-[var(--op-green-dim,rgba(74,222,128,0.2))]'
                        : 'bg-[var(--op-amber-bg,rgba(245,158,11,0.1))] text-[var(--op-amber,#F59E0B)] border-[var(--op-amber-dim,rgba(245,158,11,0.2))]'
                    }`}
                  >
                    {step.autoContinue ? 'auto' : 'pause'}
                  </button>

                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => removeStep(index)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              <Button variant="outline" size="sm" className="w-full text-xs" onClick={addStep}>
                <Plus className="h-3 w-3 mr-1" />
                Add Step
              </Button>
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
          Add Template
        </Button>
      )}
    </div>
  )
}
