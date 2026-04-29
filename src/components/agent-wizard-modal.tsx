'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WizardStep = 'requirements' | 'composing' | 'review'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'requirements', label: '1. Requirements' },
  { id: 'composing',    label: '2. Composing' },
  { id: 'review',       label: '3. Review & Save' },
]

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

  function handleCancel() {
    setStep('requirements')
    onOpenChange(false)
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
          {step === 'requirements' && <p>Requirements form (Task 3.2)</p>}
          {step === 'composing'    && <p>Composing… (Epic 4)</p>}
          {step === 'review'       && <p>Review form (Task 3.3)</p>}
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
              <Button onClick={() => setStep('composing')}>Next</Button>
            )}
            {step === 'review' && (
              <Button>Save Agent</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
