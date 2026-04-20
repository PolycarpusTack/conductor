'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X, Plus, Save, LayoutTemplate, GitBranch } from 'lucide-react'
import { AgentBadge } from '@/components/agent-badge'
import { WorkflowEditor, type DagStep, type StepEdge } from '@/components/workflow-editor'

interface StepDraft {
  agentId?: string | null
  humanLabel?: string
  mode: string
  instructions?: string
  autoContinue: boolean
  maxRetries?: number
  retryDelayMs?: number
  timeoutMs?: number
  // DAG fields
  nextSteps?: StepEdge[]
  prevSteps?: string[]
  isParallelRoot?: boolean
  isMergePoint?: boolean
  fallbackAgentId?: string | null
}

interface Agent {
  id: string
  name: string
  emoji: string
  color?: string | null
  role?: string | null
  personality?: string | null
  supportedModes?: string | null
}

interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
  icon?: string | null
}

interface ChainTemplate {
  id: string
  name: string
  description?: string | null
  icon: string
  steps: string
}

interface ChainBuilderProps {
  projectId: string
  agents: Agent[]
  modes: ProjectMode[]
  templates: ChainTemplate[]
  steps: StepDraft[]
  onStepsChange: (steps: StepDraft[]) => void
  onSaveAsTemplate?: (name: string, steps: StepDraft[]) => void
}

function parseSteps(raw: string): StepDraft[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return []
}

function parseSupportedModes(agent: Agent): string[] | null {
  if (!agent.supportedModes) return null
  try {
    const parsed = JSON.parse(agent.supportedModes)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return null
}

function getStepCount(template: ChainTemplate): number {
  return parseSteps(template.steps).length
}

function toDagStep(step: StepDraft, index: number): DagStep {
  return {
    id: `step_${index}`,
    agentId: step.agentId,
    humanLabel: step.humanLabel,
    mode: step.mode,
    instructions: step.instructions,
    autoContinue: step.autoContinue,
    nextSteps: step.nextSteps || [],
    prevSteps: step.prevSteps || [],
    isParallelRoot: step.isParallelRoot || false,
    isMergePoint: step.isMergePoint || false,
    fallbackAgentId: step.fallbackAgentId || null,
    column: index,
    row: 0,
  }
}

export function ChainBuilder({
  projectId,
  agents,
  modes,
  templates,
  steps,
  onStepsChange,
  onSaveAsTemplate,
}: ChainBuilderProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [viewMode, setViewMode] = useState<'linear' | 'visual'>('linear')

  const handleSelectTemplate = (template: ChainTemplate) => {
    setSelectedTemplate(template.id)
    const parsed = parseSteps(template.steps)
    onStepsChange(parsed)
  }

  const handleCustomChain = () => {
    setSelectedTemplate(null)
    onStepsChange([])
  }

  const addStep = () => {
    const newStep: StepDraft = {
      agentId: null,
      mode: modes[0]?.name ?? '',
      autoContinue: true,
    }
    onStepsChange([...steps, newStep])
  }

  const removeStep = (index: number) => {
    onStepsChange(steps.filter((_, i) => i !== index))
  }

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    const updated = steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    onStepsChange(updated)
  }

  const handleAgentChange = (index: number, value: string) => {
    const isHuman = value === '__human__'
    const agentId = isHuman ? null : value
    const patch: Partial<StepDraft> = {
      agentId,
      autoContinue: !isHuman,
      humanLabel: isHuman ? steps[index].humanLabel || '' : undefined,
    }

    if (!isHuman) {
      const agent = agents.find((a) => a.id === value)
      if (agent) {
        const supported = parseSupportedModes(agent)
        if (supported && !supported.includes(steps[index].mode)) {
          patch.mode = supported[0] ?? ''
        }
      }
    }

    updateStep(index, patch)
  }

  const getFilteredModes = (step: StepDraft): ProjectMode[] => {
    if (!step.agentId) return modes
    const agent = agents.find((a) => a.id === step.agentId)
    if (!agent) return modes
    const supported = parseSupportedModes(agent)
    if (!supported) return modes
    return modes.filter((m) => supported.includes(m.name))
  }

  const getModeColor = (modeName: string): string => {
    const mode = modes.find((m) => m.name === modeName)
    return mode?.color ?? '#9BAAC4'
  }

  const isHumanStep = (step: StepDraft): boolean => {
    return step.agentId === null || step.agentId === undefined
  }

  const handleSaveTemplate = () => {
    if (!onSaveAsTemplate || !saveTemplateName.trim()) return
    onSaveAsTemplate(saveTemplateName.trim(), steps)
    setSaveTemplateName('')
    setShowSaveInput(false)
  }

  const visualSteps: DagStep[] = steps.map(toDagStep)

  return (
    <div className="space-y-4">
      {/* Template selector */}
      <div className="grid gap-2">
        <label className="text-sm font-medium text-muted-foreground">Template</label>
        <Select
          value={selectedTemplate ?? '__custom__'}
          onValueChange={(value) => {
            if (value === '__custom__') {
              handleCustomChain()
            } else {
              const template = templates.find(t => t.id === value)
              if (template) handleSelectTemplate(template)
            }
          }}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Choose a workflow template..." />
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <SelectItem value="__custom__">
              <span className="flex items-center gap-2">
                <LayoutTemplate className="h-3.5 w-3.5 text-muted-foreground" />
                Custom Chain — start from scratch
              </span>
            </SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                <span className="flex items-center gap-2">
                  <span>{template.icon}</span>
                  {template.name}
                  <span className="text-muted-foreground">— {getStepCount(template)} steps</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedTemplate && (() => {
          const t = templates.find(t => t.id === selectedTemplate)
          return t?.description ? (
            <p className="text-xs text-muted-foreground">{t.description}</p>
          ) : null
        })()}
      </div>

      {/* View mode toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setViewMode('linear')}
          className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
            viewMode === 'linear' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          Linear
        </button>
        <button
          onClick={() => setViewMode('visual')}
          className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition-colors ${
            viewMode === 'visual' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <GitBranch className="h-3 w-3" />
          Visual DAG
        </button>
      </div>

      {/* Visual workflow editor */}
      {viewMode === 'visual' && (
        <WorkflowEditor
          agents={agents}
          modes={modes}
          steps={visualSteps}
          onStepsChange={(dagSteps) => {
            // Build a mapping from visual editor IDs to stable positional IDs
            // so the server can remap them to real DB IDs after creation
            const idRemap = new Map<string, string>()
            dagSteps.forEach((s, i) => idRemap.set(s.id, `step_${i}`))

            onStepsChange(dagSteps.map(s => ({
              agentId: s.agentId,
              humanLabel: s.humanLabel,
              mode: s.mode,
              instructions: s.instructions,
              autoContinue: s.autoContinue,
              nextSteps: s.nextSteps.length > 0
                ? s.nextSteps.map(e => ({ ...e, targetStepId: idRemap.get(e.targetStepId) || e.targetStepId }))
                : undefined,
              prevSteps: s.prevSteps.length > 0
                ? s.prevSteps.map(id => idRemap.get(id) || id)
                : undefined,
              isParallelRoot: s.isParallelRoot || undefined,
              isMergePoint: s.isMergePoint || undefined,
              fallbackAgentId: s.fallbackAgentId,
            })))
          }}
        />
      )}

      {/* Step list (linear mode) */}
      {viewMode === 'linear' && <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Steps</h3>
        <div className="space-y-0">
          {steps.map((step, index) => {
            const filteredModes = getFilteredModes(step)
            const modeColor = getModeColor(step.mode)
            const human = isHumanStep(step)

            return (
              <div key={index} className="relative">
                {/* Connector line */}
                {index < steps.length - 1 && (
                  <div
                    className="absolute left-[15px] top-[36px] w-0.5 h-[calc(100%-8px)]"
                    style={{ backgroundColor: modeColor + '40' }}
                  />
                )}

                <div className="flex items-center gap-2 py-2">
                  {/* Step number circle */}
                  <div
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: modeColor }}
                  >
                    {index + 1}
                  </div>

                  {/* Mode selector */}
                  <Select
                    value={step.mode}
                    onValueChange={(val) => updateStep(index, { mode: val })}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="Mode" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredModes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.name}>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ backgroundColor: mode.color }}
                            />
                            {mode.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Agent / Human selector */}
                  <Select
                    value={human ? '__human__' : step.agentId ?? ''}
                    onValueChange={(val) => handleAgentChange(index, val)}
                  >
                    <SelectTrigger className="w-[160px] h-8 text-xs">
                      <SelectValue placeholder="Agent / Human" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__human__">
                        <span className="flex items-center gap-2">🧑 Human</span>
                      </SelectItem>
                      {agents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          <AgentBadge agent={agent} size="card" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Human label input */}
                  {human && (
                    <Input
                      value={step.humanLabel ?? ''}
                      onChange={(e) => updateStep(index, { humanLabel: e.target.value })}
                      placeholder="Label (e.g. Review)"
                      className="w-[120px] h-8 text-xs"
                    />
                  )}

                  {/* Auto-continue toggle */}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-muted-foreground">
                      {step.autoContinue ? 'auto' : 'pause'}
                    </span>
                    <Switch
                      checked={step.autoContinue}
                      onCheckedChange={(checked) => updateStep(index, { autoContinue: checked })}
                    />
                  </div>

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeStep(index)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Retry policy (agent steps only) */}
                {!human && (
                  <div className="ml-[38px] mb-1 flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/60">Retries</span>
                      <Select
                        value={String(step.maxRetries ?? 2)}
                        onValueChange={(val) => updateStep(index, { maxRetries: Number(val) })}
                      >
                        <SelectTrigger className="w-[60px] h-6 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0, 1, 2, 3, 5, 10].map((n) => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/60">Delay</span>
                      <Select
                        value={String(step.retryDelayMs ?? 5000)}
                        onValueChange={(val) => updateStep(index, { retryDelayMs: Number(val) })}
                      >
                        <SelectTrigger className="w-[80px] h-6 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">Immediate</SelectItem>
                          <SelectItem value="5000">5s</SelectItem>
                          <SelectItem value="30000">30s</SelectItem>
                          <SelectItem value="60000">1m</SelectItem>
                          <SelectItem value="300000">5m</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/60">Timeout</span>
                      <Select
                        value={String(step.timeoutMs ?? 300000)}
                        onValueChange={(val) => updateStep(index, { timeoutMs: Number(val) })}
                      >
                        <SelectTrigger className="w-[72px] h-6 text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="60000">1m</SelectItem>
                          <SelectItem value="300000">5m</SelectItem>
                          <SelectItem value="600000">10m</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add step */}
        <Button
          variant="outline"
          size="sm"
          onClick={addStep}
          className="mt-3 w-full border-dashed"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Step
        </Button>
      </div>}

      {/* Save as template */}
      {onSaveAsTemplate && steps.length > 0 && (
        <div className="flex items-center gap-2">
          {showSaveInput ? (
            <>
              <Input
                value={saveTemplateName}
                onChange={(e) => setSaveTemplateName(e.target.value)}
                placeholder="Template name"
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
              />
              <Button size="sm" onClick={handleSaveTemplate} disabled={!saveTemplateName.trim()}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowSaveInput(false)
                  setSaveTemplateName('')
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSaveInput(true)}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save as Template
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
