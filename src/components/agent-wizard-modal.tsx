'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type WizardStep = 'requirements' | 'composing' | 'review'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'requirements', label: '1. Requirements' },
  { id: 'composing',    label: '2. Composing' },
  { id: 'review',       label: '3. Review & Save' },
]

const requirementsSchema = z.object({
  purpose:   z.string().trim().min(10, 'Describe the agent purpose in at least 10 characters'),
  domain:    z.string().trim().min(1, 'Domain is required'),
  goal:      z.enum(['analysis', 'security', 'documentation', 'testing', 'research', 'custom']),
  runtimeId: z.string().trim().min(1, 'Select a runtime for the LLM composition'),
})

export type WizardRequirements = z.infer<typeof requirementsSchema>

/** Shape of an agent composed by the LLM wizard. */
export interface WizardComposedAgent {
  name: string
  role: string
  personality: string
  capabilities: string[]
  systemPrompt: string
  /** Archive entry IDs used as source material */
  sourcesUsed: string[]
}

interface AgentWizardModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  /** Called after the agent is successfully saved */
  onAgentCreated: () => void
}

/** Multi-step wizard for creating an agent from natural-language requirements. */
export function AgentWizardModal({ open, onOpenChange, projectId, onAgentCreated }: AgentWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('requirements')
  const [runtimes, setRuntimes] = useState<{ id: string; name: string }[]>([])
  const [composed, setComposed] = useState<WizardComposedAgent | null>(null)
  const [saving, setSaving] = useState(false)

  const form = useForm<WizardRequirements>({
    resolver: zodResolver(requirementsSchema),
    defaultValues: { purpose: '', domain: '', goal: 'analysis', runtimeId: '' },
  })

  const reviewForm = useForm<WizardComposedAgent>({
    defaultValues: { name: '', role: '', personality: '', capabilities: [], systemPrompt: '', sourcesUsed: [] },
  })

  useEffect(() => {
    if (!open || !projectId) return
    fetch(`/api/projects/${projectId}/runtimes`)
      .then((r) => r.json())
      .then((data) => setRuntimes(data.runtimes ?? []))
      .catch(() => {})
  }, [open, projectId])

  useEffect(() => {
    if (composed) reviewForm.reset(composed)
  }, [composed])

  function handleCancel() {
    setStep('requirements')
    onOpenChange(false)
  }

  /** Saves the composed agent via POST /api/agents. */
  async function handleSaveAgent() {
    const values = reviewForm.getValues()
    if (!values.name?.trim()) {
      toast.error('Agent name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          role: values.role,
          personality: values.personality,
          capabilities: values.capabilities ?? [],
          systemPrompt: values.systemPrompt,
          projectId,
          runtimeId: form.getValues('runtimeId'),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? 'Failed to create agent')
        return
      }
      toast.success('Agent created!')
      onAgentCreated()
    } finally {
      setSaving(false)
    }
  }

  function stepIndex(s: WizardStep) {
    return STEPS.findIndex((x) => x.id === s)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent Wizard</DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 py-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-6 bg-border" />}
              <span
                className={cn(
                  'text-xs font-medium px-2 py-1 rounded',
                  step === s.id
                    ? 'bg-primary text-primary-foreground'
                    : stepIndex(step) > i
                    ? 'bg-muted text-muted-foreground line-through'
                    : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step content — filled in by subsequent tasks */}
        <div className="min-h-[300px] flex items-center justify-center text-muted-foreground text-sm">
          {step === 'requirements' && (
            <form className="space-y-4 w-full" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-1">
                <Label htmlFor="purpose">What should this agent do? *</Label>
                <Textarea
                  id="purpose"
                  placeholder="e.g. Analyze Rust/Tauri codebases for security vulnerabilities and produce a severity-ranked report"
                  rows={3}
                  {...form.register('purpose')}
                />
                {form.formState.errors.purpose && (
                  <p className="text-xs text-destructive">{form.formState.errors.purpose.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="domain">Technology stack / domain *</Label>
                <Input
                  id="domain"
                  placeholder="e.g. Rust/Tauri, Python/FastAPI, VisualWorks Smalltalk"
                  {...form.register('domain')}
                />
                {form.formState.errors.domain && (
                  <p className="text-xs text-destructive">{form.formState.errors.domain.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Primary goal *</Label>
                  <Select
                    value={form.watch('goal')}
                    onValueChange={(v) => form.setValue('goal', v as WizardRequirements['goal'])}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['analysis','security','documentation','testing','research','custom'] as const).map((g) => (
                        <SelectItem key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label>Runtime for composition *</Label>
                  <Select
                    value={form.watch('runtimeId')}
                    onValueChange={(v) => form.setValue('runtimeId', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select runtime…" />
                    </SelectTrigger>
                    <SelectContent>
                      {runtimes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.formState.errors.runtimeId && (
                    <p className="text-xs text-destructive">{form.formState.errors.runtimeId.message}</p>
                  )}
                </div>
              </div>
            </form>
          )}
          {step === 'composing'    && <p>Composing… (Epic 4)</p>}
          {step === 'review' && (
            <form className="space-y-3 w-full" onSubmit={(e) => e.preventDefault()}>
              {!composed ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin h-4 w-4 mr-2" /> Waiting for composition…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Name</Label>
                      <Input {...reviewForm.register('name')} />
                    </div>
                    <div className="space-y-1">
                      <Label>Role</Label>
                      <Input {...reviewForm.register('role')} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Personality</Label>
                    <Input {...reviewForm.register('personality')} />
                  </div>
                  <div className="space-y-1">
                    <Label>System Prompt</Label>
                    <Textarea rows={8} className="font-mono text-xs" {...reviewForm.register('systemPrompt')} />
                  </div>
                  {composed.sourcesUsed.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sources used: {composed.sourcesUsed.join(', ')}
                    </p>
                  )}
                </>
              )}
            </form>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between pt-2 border-t">
          <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
          <div className="flex gap-2">
            {step !== 'requirements' && (
              <Button variant="outline" onClick={() => setStep(step === 'review' ? 'composing' : 'requirements')}>
                Back
              </Button>
            )}
            {step === 'requirements' && (
              <Button onClick={() => form.handleSubmit(() => setStep('composing'))()}>
                Next
              </Button>
            )}
            {step === 'review' && (
              <Button onClick={handleSaveAgent} disabled={saving || !composed}>
                {saving ? <><Loader2 className="animate-spin h-4 w-4 mr-2" />Saving…</> : 'Save Agent'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
