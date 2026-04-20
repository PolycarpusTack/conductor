'use client'

import { useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { StepCondition, StepEdge } from '@/lib/server/condition-evaluator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X, Plus, GitBranch, GitMerge, ArrowRight, Trash2, Zap } from 'lucide-react'
import { AgentBadge } from '@/components/agent-badge'

export type { StepCondition, StepEdge }

export interface DagStep {
  id: string
  agentId?: string | null
  humanLabel?: string
  mode: string
  instructions?: string
  autoContinue: boolean
  nextSteps: StepEdge[]
  prevSteps: string[]
  isParallelRoot: boolean
  isMergePoint: boolean
  fallbackAgentId?: string | null
  // Layout
  column: number
  row: number
}

interface Agent {
  id: string
  name: string
  emoji: string
  color?: string | null
  role?: string | null
  personality?: string | null
}

interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
}

interface WorkflowEditorProps {
  agents: Agent[]
  modes: ProjectMode[]
  steps: DagStep[]
  onStepsChange: (steps: DagStep[]) => void
}

const MODE_COLORS: Record<string, string> = {
  analyze: '#60A5FA',
  verify: '#F59E0B',
  develop: '#4ADE80',
  review: '#2DD4BF',
  draft: '#A78BFA',
  human: '#9CA3AF',
}

let nextId = 1
function generateId(): string {
  return `step_${Date.now()}_${nextId++}`
}

function ConditionEditor({
  condition,
  onChange,
  onRemove,
}: {
  condition?: StepCondition
  onChange: (c: StepCondition | undefined) => void
  onRemove: () => void
}) {
  if (!condition) {
    return (
      <button
        onClick={() => onChange({ field: 'output', operator: 'contains', value: '' })}
        className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground"
      >
        + Add condition
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <select
        value={condition.field}
        onChange={e => onChange({ ...condition, field: e.target.value as StepCondition['field'] })}
        className="text-[9px] bg-card border border-border/30 rounded px-1 py-0.5"
      >
        <option value="output">output</option>
        <option value="status">status</option>
        <option value="error">error</option>
        <option value="tokensUsed">tokensUsed</option>
      </select>
      <select
        value={condition.operator}
        onChange={e => onChange({ ...condition, operator: e.target.value as StepCondition['operator'] })}
        className="text-[9px] bg-card border border-border/30 rounded px-1 py-0.5"
      >
        <option value="contains">contains</option>
        <option value="not_contains">not contains</option>
        <option value="equals">equals</option>
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
        <option value="matches">matches</option>
      </select>
      <input
        type="text"
        value={condition.value}
        onChange={e => onChange({ ...condition, value: e.target.value })}
        placeholder="value"
        className="text-[9px] bg-card border border-border/30 rounded px-1 py-0.5 w-20"
      />
      <button onClick={onRemove} className="text-[9px] text-red-400 hover:text-red-300">
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

function StepNode({
  step,
  agents,
  modes,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onStartConnect,
}: {
  step: DagStep
  agents: Agent[]
  modes: ProjectMode[]
  isSelected: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<DagStep>) => void
  onDelete: () => void
  onStartConnect: () => void
}) {
  const agent = agents.find(a => a.id === step.agentId)
  const modeColor = MODE_COLORS[step.mode] || '#9CA3AF'

  return (
    <div
      onClick={onSelect}
      className={`absolute p-3 rounded-lg border-2 bg-card/80 backdrop-blur-sm cursor-pointer transition-all min-w-[160px] ${
        isSelected ? 'border-primary shadow-lg shadow-primary/10' : 'border-border/30 hover:border-border/60'
      }`}
      style={{
        left: step.column * 220 + 20,
        top: step.row * 120 + 20,
      }}
    >
      {/* Badges */}
      <div className="flex items-center gap-1 mb-1.5">
        {step.isParallelRoot && (
          <span className="text-[8px] font-mono bg-blue-500/10 text-blue-400 px-1 rounded">
            <GitBranch className="h-2 w-2 inline mr-0.5" />FORK
          </span>
        )}
        {step.isMergePoint && (
          <span className="text-[8px] font-mono bg-purple-500/10 text-purple-400 px-1 rounded">
            <GitMerge className="h-2 w-2 inline mr-0.5" />JOIN
          </span>
        )}
        {step.fallbackAgentId && (
          <span className="text-[8px] font-mono bg-amber-500/10 text-amber-400 px-1 rounded">
            <Zap className="h-2 w-2 inline mr-0.5" />FB
          </span>
        )}
      </div>

      {/* Mode badge */}
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: `${modeColor}15`, color: modeColor }}
        >
          {step.mode}
        </span>
      </div>

      {/* Agent */}
      <div className="text-xs text-muted-foreground truncate">
        {agent ? <AgentBadge agent={agent} size="card" /> : (step.humanLabel || 'Human')}
      </div>

      {/* Connect button (output port) */}
      <button
        onClick={(e) => { e.stopPropagation(); onStartConnect() }}
        className="absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-primary/80 border-2 border-background hover:bg-primary flex items-center justify-center"
        title="Connect to next step"
      >
        <ArrowRight className="h-2 w-2 text-primary-foreground" />
      </button>

      {/* Delete button */}
      {isSelected && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-destructive flex items-center justify-center"
        >
          <X className="h-3 w-3 text-destructive-foreground" />
        </button>
      )}
    </div>
  )
}

export function WorkflowEditor({ agents, modes, steps, onStepsChange }: WorkflowEditorProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)

  const selectedStep = steps.find(s => s.id === selectedStepId)

  const addStep = useCallback(() => {
    const maxCol = steps.length > 0 ? Math.max(...steps.map(s => s.column)) : -1
    const newStep: DagStep = {
      id: generateId(),
      mode: modes[0]?.name ?? 'develop',
      autoContinue: true,
      nextSteps: [],
      prevSteps: [],
      isParallelRoot: false,
      isMergePoint: false,
      column: maxCol + 1,
      row: 0,
    }
    onStepsChange([...steps, newStep])
    setSelectedStepId(newStep.id)
  }, [steps, modes, onStepsChange])

  const deleteStep = useCallback((stepId: string) => {
    // Remove step and clean up references
    const updated = steps
      .filter(s => s.id !== stepId)
      .map(s => ({
        ...s,
        nextSteps: s.nextSteps.filter(e => e.targetStepId !== stepId),
        prevSteps: s.prevSteps.filter(id => id !== stepId),
      }))
    onStepsChange(updated)
    if (selectedStepId === stepId) setSelectedStepId(null)
  }, [steps, selectedStepId, onStepsChange])

  const updateStep = useCallback((stepId: string, patch: Partial<DagStep>) => {
    onStepsChange(steps.map(s => s.id === stepId ? { ...s, ...patch } : s))
  }, [steps, onStepsChange])

  const handleConnect = useCallback((targetId: string) => {
    if (!connectingFrom || connectingFrom === targetId) {
      setConnectingFrom(null)
      return
    }

    // Cycle detection: BFS from targetId to see if we can reach connectingFrom
    const visited = new Set<string>()
    const queue = [targetId]
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === connectingFrom) {
        // Adding this edge would create a cycle — reject it
        setConnectingFrom(null)
        return
      }
      if (visited.has(current)) continue
      visited.add(current)
      const step = steps.find(s => s.id === current)
      if (step) {
        for (const edge of step.nextSteps) {
          if (!visited.has(edge.targetStepId)) {
            queue.push(edge.targetStepId)
          }
        }
      }
    }

    // Add edge from connectingFrom to targetId
    const updated = steps.map(s => {
      if (s.id === connectingFrom) {
        const alreadyConnected = s.nextSteps.some(e => e.targetStepId === targetId)
        if (alreadyConnected) return s
        return {
          ...s,
          nextSteps: [...s.nextSteps, { targetStepId: targetId }],
        }
      }
      if (s.id === targetId) {
        const alreadyPrev = s.prevSteps.includes(connectingFrom)
        if (alreadyPrev) return s
        return {
          ...s,
          prevSteps: [...s.prevSteps, connectingFrom],
        }
      }
      return s
    })
    onStepsChange(updated)
    setConnectingFrom(null)
  }, [connectingFrom, steps, onStepsChange])

  const removeEdge = useCallback((fromId: string, toId: string) => {
    const updated = steps.map(s => {
      if (s.id === fromId) {
        return { ...s, nextSteps: s.nextSteps.filter(e => e.targetStepId !== toId) }
      }
      if (s.id === toId) {
        return { ...s, prevSteps: s.prevSteps.filter(id => id !== fromId) }
      }
      return s
    })
    onStepsChange(updated)
  }, [steps, onStepsChange])

  const updateEdgeCondition = useCallback((fromId: string, toId: string, condition: StepCondition | undefined, label?: string) => {
    const updated = steps.map(s => {
      if (s.id === fromId) {
        return {
          ...s,
          nextSteps: s.nextSteps.map(e =>
            e.targetStepId === toId ? { ...e, condition, label } : e
          ),
        }
      }
      return s
    })
    onStepsChange(updated)
  }, [steps, onStepsChange])

  // Compute SVG edges
  const svgEdges = useMemo(() => {
    const edges: Array<{
      fromId: string; toId: string
      x1: number; y1: number; x2: number; y2: number
      label?: string; hasCondition: boolean
    }> = []

    for (const step of steps) {
      for (const edge of step.nextSteps) {
        const target = steps.find(s => s.id === edge.targetStepId)
        if (!target) continue
        edges.push({
          fromId: step.id,
          toId: target.id,
          x1: step.column * 220 + 180,
          y1: step.row * 120 + 55,
          x2: target.column * 220 + 20,
          y2: target.row * 120 + 55,
          label: edge.label,
          hasCondition: !!edge.condition,
        })
      }
    }
    return edges
  }, [steps])

  const canvasWidth = Math.max(600, (Math.max(0, ...steps.map(s => s.column)) + 2) * 220)
  const canvasHeight = Math.max(300, (Math.max(0, ...steps.map(s => s.row)) + 2) * 120)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="text-xs h-7" onClick={addStep}>
          <Plus className="h-3 w-3 mr-1" />
          Add Step
        </Button>
        {connectingFrom && (
          <span className="text-xs text-muted-foreground animate-pulse">
            Click a step to connect to... (Esc to cancel)
          </span>
        )}
      </div>

      {/* Canvas */}
      <div
        className="relative border border-border/30 rounded-lg bg-card/20 overflow-auto"
        style={{ minHeight: canvasHeight }}
        onClick={() => {
          if (connectingFrom) setConnectingFrom(null)
          else setSelectedStepId(null)
        }}
        onKeyDown={e => { if (e.key === 'Escape') setConnectingFrom(null) }}
        tabIndex={0}
      >
        {/* SVG Edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={canvasWidth}
          height={canvasHeight}
        >
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="currentColor" className="text-muted-foreground/40" />
            </marker>
            <marker id="arrowhead-cond" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="currentColor" className="text-amber-400/60" />
            </marker>
          </defs>
          {svgEdges.map((edge, i) => {
            const midX = (edge.x1 + edge.x2) / 2
            return (
              <g key={i}>
                <path
                  d={`M ${edge.x1} ${edge.y1} C ${midX} ${edge.y1}, ${midX} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                  fill="none"
                  stroke={edge.hasCondition ? 'rgba(245,158,11,0.4)' : 'rgba(156,163,175,0.3)'}
                  strokeWidth={2}
                  markerEnd={edge.hasCondition ? 'url(#arrowhead-cond)' : 'url(#arrowhead)'}
                />
                {edge.label && (
                  <text
                    x={midX}
                    y={(edge.y1 + edge.y2) / 2 - 6}
                    textAnchor="middle"
                    className="text-[8px] fill-muted-foreground/60"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Step Nodes */}
        {steps.map(step => (
          <StepNode
            key={step.id}
            step={step}
            agents={agents}
            modes={modes}
            isSelected={selectedStepId === step.id}
            onSelect={() => {
              if (connectingFrom) {
                handleConnect(step.id)
              } else {
                setSelectedStepId(step.id)
              }
            }}
            onUpdate={(patch) => updateStep(step.id, patch)}
            onDelete={() => deleteStep(step.id)}
            onStartConnect={() => setConnectingFrom(step.id)}
          />
        ))}

        {steps.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Click "Add Step" to start building your workflow
          </div>
        )}
      </div>

      {/* Properties Panel */}
      {selectedStep && (
        <div className="border border-border/30 rounded-lg p-3 bg-card/30 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">Step Properties</div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Mode</label>
              <Select
                value={selectedStep.mode}
                onValueChange={v => updateStep(selectedStep.id, { mode: v })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modes.map(m => (
                    <SelectItem key={m.id} value={m.name} className="text-xs">{m.label}</SelectItem>
                  ))}
                  <SelectItem value="human" className="text-xs">Human Review</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground">Agent</label>
              <Select
                value={selectedStep.agentId || '__human__'}
                onValueChange={v => updateStep(selectedStep.id, {
                  agentId: v === '__human__' ? null : v,
                  mode: v === '__human__' ? 'human' : selectedStep.mode,
                })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__human__" className="text-xs">Human</SelectItem>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.emoji} {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">Instructions</label>
            <Input
              value={selectedStep.instructions || ''}
              onChange={e => updateStep(selectedStep.id, { instructions: e.target.value })}
              className="h-7 text-xs"
              placeholder="Step-specific instructions..."
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedStep.isParallelRoot}
                onChange={e => updateStep(selectedStep.id, { isParallelRoot: e.target.checked })}
                className="rounded"
              />
              <span className="text-[10px]">Parallel Fork</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedStep.isMergePoint}
                onChange={e => updateStep(selectedStep.id, { isMergePoint: e.target.checked })}
                className="rounded"
              />
              <span className="text-[10px]">Merge/Join</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedStep.autoContinue}
                onChange={e => updateStep(selectedStep.id, { autoContinue: e.target.checked })}
                className="rounded"
              />
              <span className="text-[10px]">Auto-continue</span>
            </label>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">Fallback Agent</label>
            <Select
              value={selectedStep.fallbackAgentId || '__none__'}
              onValueChange={v => updateStep(selectedStep.id, { fallbackAgentId: v === '__none__' ? null : v })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">None</SelectItem>
                {agents.map(a => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.emoji} {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Outgoing edges */}
          {selectedStep.nextSteps.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Outgoing Edges</div>
              {selectedStep.nextSteps.map(edge => {
                const target = steps.find(s => s.id === edge.targetStepId)
                if (!target) return null
                const targetAgent = agents.find(a => a.id === target.agentId)
                return (
                  <div key={edge.targetStepId} className="flex items-center gap-2 mb-2 p-2 rounded bg-muted/20 border border-border/20">
                    <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-muted-foreground truncate">
                        {targetAgent ? `${targetAgent.emoji} ${targetAgent.name}` : target.humanLabel || 'Human'} ({target.mode})
                      </div>
                      <Input
                        value={edge.label || ''}
                        onChange={e => updateEdgeCondition(selectedStep.id, edge.targetStepId, edge.condition, e.target.value)}
                        placeholder="Edge label (e.g., 'if high risk')"
                        className="h-5 text-[9px] mt-1"
                      />
                      <div className="mt-1">
                        <ConditionEditor
                          condition={edge.condition}
                          onChange={c => updateEdgeCondition(selectedStep.id, edge.targetStepId, c, edge.label)}
                          onRemove={() => removeEdge(selectedStep.id, edge.targetStepId)}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => removeEdge(selectedStep.id, edge.targetStepId)}
                      className="text-muted-foreground/50 hover:text-destructive flex-shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
