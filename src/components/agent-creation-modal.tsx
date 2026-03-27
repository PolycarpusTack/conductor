'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { X } from 'lucide-react'

interface Agent {
  id: string
  name: string
  emoji: string
  color: string
  description?: string | null
  role?: string | null
  capabilities?: string | null
  maxConcurrent: number
  supportedModes?: string | null
  modeInstructions?: string | null
  runtimeId?: string | null
  runtimeModel?: string | null
  systemPrompt?: string | null
  mcpConnectionIds?: string | null
  isActive: boolean
  lastSeen?: string | null
}

interface ProjectMode {
  id: string
  name: string
  label: string
  color: string
  icon?: string | null
}

interface ProjectRuntime {
  id: string
  adapter: string
  name: string
  models: string
}

interface ProjectMcpConnection {
  id: string
  name: string
  type: string
  icon?: string | null
}

interface AgentCreationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  editingAgent?: Agent | null
  modes: ProjectMode[]
  runtimes: ProjectRuntime[]
  mcpConnections: ProjectMcpConnection[]
  onSave: (agent: Agent) => void
}

const ROLES = ['developer', 'researcher', 'writer', 'support', 'qa', 'analyst', 'custom'] as const

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

const ROLE_TEMPLATES: Record<string, string> = {
  developer: 'You are a Developer Agent. Write clean, tested code that follows project conventions. Document changes and flag uncertainties.',
  researcher: 'You are a Research Agent. Investigate topics thoroughly, gather evidence from multiple sources, and produce structured reports with confidence levels.',
  writer: 'You are a Writer Agent. Draft clear, accurate content that matches the project tone and style. Note areas needing human review.',
  support: 'You are a Support Analyst. Triage issues, reproduce bugs, identify root causes, and propose fixes with evidence.',
  qa: 'You are a QA Agent. Test systematically, design cases covering happy paths and edge cases, and document all findings.',
  analyst: 'You are a Product Analyst. Evaluate features for feasibility, effort, and business value. Provide actionable recommendations.',
}

function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseModels(models: string): { id: string, name: string, tier?: string }[] {
  if (typeof models === 'string') {
    return parseJsonSafe(models, [])
  }
  if (Array.isArray(models)) return models
  return []
}

export function AgentCreationModal({
  open,
  onOpenChange,
  projectId,
  editingAgent,
  modes,
  runtimes,
  mcpConnections,
  onSave,
}: AgentCreationModalProps) {
  const [tab, setTab] = useState('identity')
  const [saving, setSaving] = useState(false)

  // Identity fields
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [role, setRole] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [capabilityInput, setCapabilityInput] = useState('')
  const [selectedModes, setSelectedModes] = useState<string[]>([])
  const [modeInstructions, setModeInstructions] = useState<Record<string, string>>({})
  const [maxConcurrent, setMaxConcurrent] = useState(1)
  const [color, setColor] = useState('#3b82f6')

  // Runtime fields
  const [runtimeId, setRuntimeId] = useState<string | null>(null)
  const [runtimeModel, setRuntimeModel] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')

  // Connections
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([])

  const isEditing = !!editingAgent

  useEffect(() => {
    if (!open) return
    if (editingAgent) {
      setName(editingAgent.name)
      setEmoji(editingAgent.emoji || '🤖')
      setRole(editingAgent.role || null)
      setDescription(editingAgent.description || '')
      setCapabilities(parseJsonSafe<string[]>(editingAgent.capabilities, []))
      setSelectedModes(parseJsonSafe<string[]>(editingAgent.supportedModes, []))
      setModeInstructions(parseJsonSafe<Record<string, string>>(editingAgent.modeInstructions, {}))
      setMaxConcurrent(editingAgent.maxConcurrent || 1)
      setColor(editingAgent.color || '#3b82f6')
      setRuntimeId(editingAgent.runtimeId || null)
      setRuntimeModel(editingAgent.runtimeModel || null)
      setSystemPrompt(editingAgent.systemPrompt || '')
      setSelectedMcpIds(parseJsonSafe<string[]>(editingAgent.mcpConnectionIds, []))
    } else {
      setName('')
      setEmoji('🤖')
      setRole(null)
      setDescription('')
      setCapabilities([])
      setCapabilityInput('')
      setSelectedModes([])
      setModeInstructions({})
      setMaxConcurrent(1)
      setColor('#3b82f6')
      setRuntimeId(null)
      setRuntimeModel(null)
      setSystemPrompt('')
      setSelectedMcpIds([])
    }
    setTab('identity')
    setSaving(false)
  }, [open, editingAgent])

  const selectedRuntime = runtimes.find((r) => r.id === runtimeId)
  const availableModels = selectedRuntime ? parseModels(selectedRuntime.models) : []

  const addCapability = () => {
    const trimmed = capabilityInput.trim()
    if (trimmed && !capabilities.includes(trimmed) && capabilities.length < 20) {
      setCapabilities([...capabilities, trimmed])
      setCapabilityInput('')
    }
  }

  const removeCapability = (cap: string) => {
    setCapabilities(capabilities.filter((c) => c !== cap))
  }

  const toggleMode = (modeId: string) => {
    if (selectedModes.includes(modeId)) {
      setSelectedModes(selectedModes.filter((m) => m !== modeId))
      const next = { ...modeInstructions }
      delete next[modeId]
      setModeInstructions(next)
    } else {
      setSelectedModes([...selectedModes, modeId])
    }
  }

  const toggleMcp = (id: string) => {
    if (selectedMcpIds.includes(id)) {
      setSelectedMcpIds(selectedMcpIds.filter((m) => m !== id))
    } else {
      setSelectedMcpIds([...selectedMcpIds, id])
    }
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)

    const payload: Record<string, unknown> = {
      name: name.trim(),
      emoji,
      color,
      description: description.trim() || undefined,
      role: role || undefined,
      capabilities: capabilities.length > 0 ? capabilities : undefined,
      maxConcurrent,
      supportedModes: selectedModes.length > 0 ? selectedModes : undefined,
      modeInstructions: Object.keys(modeInstructions).length > 0 ? modeInstructions : undefined,
      runtimeId: runtimeId || undefined,
      runtimeModel: runtimeModel || undefined,
      systemPrompt: systemPrompt.trim() || undefined,
      mcpConnectionIds: selectedMcpIds.length > 0 ? selectedMcpIds : undefined,
    }

    if (!isEditing) {
      payload.projectId = projectId
    }

    try {
      const url = isEditing ? `/api/agents/${editingAgent.id}` : '/api/agents'
      const method = isEditing ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('Save agent failed:', err)
        setSaving(false)
        return
      }

      const saved = await res.json()
      onSave(saved)
      onOpenChange(false)
    } catch (err) {
      console.error('Save agent error:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update agent configuration.' : 'Configure a new agent for your project.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-full">
            <TabsTrigger value="identity" className="flex-1">Identity</TabsTrigger>
            <TabsTrigger value="runtime" className="flex-1">Runtime</TabsTrigger>
            <TabsTrigger value="connections" className="flex-1">Connections</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4">
            {/* Tab 1: Identity */}
            <TabsContent value="identity" className="mt-0 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1.5 block">Name</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Agent name"
                    maxLength={120}
                  />
                </div>
                <div className="w-20">
                  <label className="text-sm font-medium mb-1.5 block text-center">Emoji</label>
                  <Input
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="text-center text-lg"
                    maxLength={16}
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(role === r ? null : r)}
                      className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                        role === r
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this agent do?"
                  rows={2}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
                <div className="flex gap-2">
                  <Input
                    value={capabilityInput}
                    onChange={(e) => setCapabilityInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCapability()
                      }
                    }}
                    placeholder="Add capability, press Enter"
                    maxLength={60}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addCapability}>
                    Add
                  </Button>
                </div>
                {capabilities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {capabilities.map((cap) => (
                      <Badge key={cap} variant="secondary" className="gap-1">
                        {cap}
                        <button
                          type="button"
                          onClick={() => removeCapability(cap)}
                          className="ml-0.5 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm font-medium mb-1.5 block">Supported Modes</label>
                {modes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No modes configured for this project.</p>
                ) : (
                  <div className="space-y-2">
                    {modes.map((mode) => (
                      <div key={mode.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`mode-${mode.id}`}
                            checked={selectedModes.includes(mode.name)}
                            onCheckedChange={() => toggleMode(mode.name)}
                          />
                          <label htmlFor={`mode-${mode.id}`} className="text-sm flex items-center gap-1.5 cursor-pointer">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block"
                              style={{ backgroundColor: mode.color }}
                            />
                            {mode.label}
                          </label>
                        </div>
                        {selectedModes.includes(mode.name) && (
                          <Textarea
                            value={modeInstructions[mode.name] || ''}
                            onChange={(e) =>
                              setModeInstructions({ ...modeInstructions, [mode.name]: e.target.value })
                            }
                            placeholder={`Instructions for ${mode.label} mode (optional)`}
                            rows={2}
                            className="ml-6 text-sm"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-4">
                <div className="w-40">
                  <label className="text-sm font-medium mb-1.5 block">Max Concurrent</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Color</label>
                  <div className="flex gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-all ${
                          color === c ? 'ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Tab 2: Runtime */}
            <TabsContent value="runtime" className="mt-0 space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Runtime</label>
                {runtimes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Configure runtimes in Settings first.</p>
                ) : (
                  <Select
                    value={runtimeId || ''}
                    onValueChange={(v) => {
                      setRuntimeId(v || null)
                      setRuntimeModel(null)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a runtime" />
                    </SelectTrigger>
                    <SelectContent>
                      {runtimes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} ({r.adapter})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {runtimeId && availableModels.length > 0 && (
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Model</label>
                  <Select
                    value={runtimeModel || ''}
                    onValueChange={(v) => setRuntimeModel(v || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}{m.tier ? ` (${m.tier})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">System Prompt</label>
                  {role && role !== 'custom' && ROLE_TEMPLATES[role] && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-auto py-1"
                      onClick={() => setSystemPrompt(ROLE_TEMPLATES[role] || '')}
                    >
                      Load {role} template
                    </Button>
                  )}
                </div>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="System prompt for this agent..."
                  rows={8}
                  className="font-mono text-sm"
                  maxLength={10000}
                />
              </div>
            </TabsContent>

            {/* Tab 3: Connections */}
            <TabsContent value="connections" className="mt-0 space-y-4">
              {mcpConnections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Configure MCP connections in Settings first.</p>
              ) : (
                <div className="space-y-2">
                  {mcpConnections.map((mcp) => (
                    <div
                      key={mcp.id}
                      className="flex items-center gap-3 p-2 rounded-md border"
                    >
                      <Checkbox
                        id={`mcp-${mcp.id}`}
                        checked={selectedMcpIds.includes(mcp.id)}
                        onCheckedChange={() => toggleMcp(mcp.id)}
                      />
                      <label htmlFor={`mcp-${mcp.id}`} className="flex-1 cursor-pointer">
                        <span className="text-sm font-medium">{mcp.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{mcp.type}</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Connections are optional. MCPs expand what the agent can access.
              </p>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? 'Saving...' : isEditing ? 'Update Agent' : 'Create Agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
