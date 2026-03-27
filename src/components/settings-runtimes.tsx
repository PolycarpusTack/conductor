'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Trash2, Pencil, Plus, RefreshCw } from 'lucide-react'

interface RuntimeModel {
  id: string
  name: string
  tier?: string
}

interface Runtime {
  id: string
  adapter: string
  name: string
  models: unknown
  apiKeyEnvVar?: string | null
  endpoint?: string | null
}

interface SettingsRuntimesProps {
  projectId: string
  runtimes: Runtime[]
  onRuntimesChange: (runtimes: Runtime[]) => void
}

const ADAPTER_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic', canDiscover: true, disabled: false },
  { value: 'openai', label: 'OpenAI', canDiscover: true, disabled: false },
  { value: 'z-ai', label: 'Z.ai', canDiscover: true, disabled: false },
  { value: 'google', label: 'Google Gemini', canDiscover: true, disabled: false },
  { value: 'webhook', label: 'Custom Webhook', canDiscover: false, disabled: false },
  { value: 'github-copilot', label: 'GitHub Copilot', canDiscover: false, disabled: true },
]

const TIER_COLORS: Record<string, string> = {
  fast: 'bg-[var(--op-green-bg,rgba(74,222,128,0.1))] text-[var(--op-green,#4ADE80)] border-[var(--op-green-dim,rgba(74,222,128,0.2))]',
  balanced: 'bg-[var(--op-blue-bg,rgba(96,165,250,0.1))] text-[var(--op-blue,#60A5FA)] border-[var(--op-blue-dim,rgba(96,165,250,0.2))]',
  smart: 'bg-[var(--op-purple-bg,rgba(167,139,250,0.1))] text-[var(--op-purple,#A78BFA)] border-[var(--op-purple-dim,rgba(167,139,250,0.2))]',
  deep: 'bg-[var(--op-amber-bg,rgba(245,158,11,0.1))] text-[var(--op-amber,#F59E0B)] border-[var(--op-amber-dim,rgba(245,158,11,0.2))]',
}

function parseModels(models: unknown): RuntimeModel[] {
  if (Array.isArray(models)) return models
  if (typeof models === 'string') {
    try { return JSON.parse(models) } catch { return [] }
  }
  return []
}

export function SettingsRuntimes({ projectId, runtimes, onRuntimesChange }: SettingsRuntimesProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [adapter, setAdapter] = useState('anthropic')
  const [name, setName] = useState('')
  const [models, setModels] = useState<RuntimeModel[]>([])
  const [apiKeyEnvVar, setApiKeyEnvVar] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Discovery state
  const [discovering, setDiscovering] = useState(false)
  const [discoveredModels, setDiscoveredModels] = useState<RuntimeModel[]>([])
  const [showDiscovered, setShowDiscovered] = useState(false)

  const canDiscover = ADAPTER_OPTIONS.find(a => a.value === adapter)?.canDiscover && apiKeyEnvVar.trim()

  const resetForm = () => {
    setAdapter('anthropic')
    setName('')
    setModels([])
    setApiKeyEnvVar('')
    setEndpoint('')
    setError(null)
    setDiscoveredModels([])
    setShowDiscovered(false)
  }

  const startEdit = (runtime: Runtime) => {
    setEditing(runtime.id)
    setAdapter(runtime.adapter)
    setName(runtime.name)
    setModels(parseModels(runtime.models))
    setApiKeyEnvVar(runtime.apiKeyEnvVar || '')
    setEndpoint(runtime.endpoint || '')
    setCreating(false)
    setDiscoveredModels([])
    setShowDiscovered(false)
  }

  const handleDiscover = async () => {
    if (!apiKeyEnvVar.trim()) {
      setError('Enter the API key env variable name first')
      return
    }

    setDiscovering(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${projectId}/runtimes/discover-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapter, apiKeyEnvVar }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to discover models')
      }

      const data = await res.json()
      setDiscoveredModels(data.models || [])
      setShowDiscovered(true)

      // Auto-select all if no models are currently selected
      if (models.length === 0 && data.models.length > 0) {
        setModels(data.models)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover models')
    } finally {
      setDiscovering(false)
    }
  }

  const toggleModel = (model: RuntimeModel) => {
    const exists = models.find(m => m.id === model.id)
    if (exists) {
      setModels(prev => prev.filter(m => m.id !== model.id))
    } else {
      setModels(prev => [...prev, model])
    }
  }

  const selectAllModels = () => setModels([...discoveredModels])
  const deselectAllModels = () => setModels([])

  const handleSave = async () => {
    setError(null)

    if (models.length === 0) {
      setError('Select at least one model')
      return
    }

    try {
      const payload = {
        adapter,
        name,
        models,
        apiKeyEnvVar: apiKeyEnvVar || undefined,
        endpoint: endpoint || undefined,
      }

      if (editing) {
        const res = await fetch(`/api/projects/${projectId}/runtimes/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to update runtime')
        const updated = await res.json()
        onRuntimesChange(runtimes.map(r => r.id === editing ? updated : r))
      } else {
        const res = await fetch(`/api/projects/${projectId}/runtimes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json()).error || 'Failed to create runtime')
        const created = await res.json()
        onRuntimesChange([...runtimes, created])
      }
      setEditing(null)
      setCreating(false)
      resetForm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const handleDelete = async (runtimeId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/runtimes/${runtimeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      onRuntimesChange(runtimes.filter(r => r.id !== runtimeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const modelsToShow = showDiscovered ? discoveredModels : models

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {runtimes.map((runtime) => (
        <div key={runtime.id} className="flex items-center justify-between p-3 rounded-lg border border-border/30 bg-card/50">
          <div className="flex items-center gap-3">
            <div className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {runtime.adapter}
            </div>
            <div>
              <div className="text-sm font-medium">{runtime.name}</div>
              <div className="text-xs text-muted-foreground">
                {parseModels(runtime.models).length} model{parseModels(runtime.models).length !== 1 ? 's' : ''}: {parseModels(runtime.models).map(m => m.name).join(', ')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => startEdit(runtime)}>
              <Pencil className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(runtime.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}

      {(creating || editing) ? (
        <div className="p-4 rounded-lg border border-border/30 bg-card/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Adapter</label>
              <Select value={adapter} onValueChange={v => { setAdapter(v); setDiscoveredModels([]); setShowDiscovered(false) }}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADAPTER_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label}{opt.disabled ? ' (coming soon)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Display Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Anthropic Claude" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">API Key Env Variable</label>
              <Input value={apiKeyEnvVar} onChange={e => setApiKeyEnvVar(e.target.value)} placeholder="ANTHROPIC_API_KEY" className="mt-1" />
              <p className="text-[10px] text-muted-foreground/60 mt-1">Server environment variable name (not the key itself)</p>
            </div>
            {adapter === 'webhook' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground">Webhook Endpoint</label>
                <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://your-service.com/dispatch" className="mt-1" />
              </div>
            )}
          </div>

          {/* Models section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Models {models.length > 0 && `(${models.length} selected)`}
              </label>
              <div className="flex items-center gap-2">
                {showDiscovered && discoveredModels.length > 0 && (
                  <>
                    <button onClick={selectAllModels} className="text-[10px] text-muted-foreground hover:text-foreground">
                      Select all
                    </button>
                    <span className="text-[10px] text-muted-foreground/30">|</span>
                    <button onClick={deselectAllModels} className="text-[10px] text-muted-foreground hover:text-foreground">
                      Clear
                    </button>
                  </>
                )}
                {canDiscover && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    onClick={handleDiscover}
                    disabled={discovering}
                  >
                    <RefreshCw className={`h-3 w-3 ${discovering ? 'animate-spin' : ''}`} />
                    {discovering ? 'Fetching...' : showDiscovered ? 'Refresh' : 'Fetch Models'}
                  </Button>
                )}
              </div>
            </div>

            {modelsToShow.length > 0 ? (
              <div className="rounded-md border border-border/30 divide-y divide-border/20 max-h-[240px] overflow-y-auto">
                {modelsToShow.map((model) => {
                  const isSelected = models.some(m => m.id === model.id)
                  return (
                    <label
                      key={model.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-card/80' : 'hover:bg-card/40'}`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleModel(model)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{model.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{model.id}</div>
                      </div>
                      {model.tier && (
                        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${TIER_COLORS[model.tier] || TIER_COLORS.balanced}`}>
                          {model.tier}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/30 p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {canDiscover
                    ? 'Click "Fetch Models" to discover available models from the API'
                    : adapter === 'webhook'
                      ? 'Webhook runtimes don\'t have discoverable models. Add them manually below.'
                      : 'Enter the API key env variable, then fetch available models'
                  }
                </p>
              </div>
            )}

            {/* Manual add for webhook or fallback */}
            {(adapter === 'webhook' || (!showDiscovered && models.length === 0)) && (
              <div className="mt-2">
                <ManualModelInput onAdd={(model) => setModels(prev => [...prev, model])} />
              </div>
            )}

            {/* Show selected models as tags when discovery is active */}
            {showDiscovered && models.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {models.map(m => (
                  <span key={m.id} className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {m.name}
                    <button onClick={() => toggleModel(m)} className="hover:text-destructive">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setEditing(null); setCreating(false); resetForm() }}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => { resetForm(); setCreating(true) }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Runtime
        </Button>
      )}
    </div>
  )
}

// Small inline component for manually adding a model
function ManualModelInput({ onAdd }: { onAdd: (model: RuntimeModel) => void }) {
  const [id, setId] = useState('')
  const [modelName, setModelName] = useState('')

  const handleAdd = () => {
    if (!id.trim() || !modelName.trim()) return
    onAdd({ id: id.trim(), name: modelName.trim(), tier: 'balanced' })
    setId('')
    setModelName('')
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={id}
        onChange={e => setId(e.target.value)}
        placeholder="model-id"
        className="flex-1 text-xs font-mono h-8"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Input
        value={modelName}
        onChange={e => setModelName(e.target.value)}
        placeholder="Display name"
        className="flex-1 text-xs h-8"
        onKeyDown={e => e.key === 'Enter' && handleAdd()}
      />
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleAdd}>
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  )
}
