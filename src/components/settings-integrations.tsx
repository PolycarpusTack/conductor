'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/settings-confirm-dialog'
import { useToast } from '@/hooks/use-toast'

type Reaction = {
  id: string
  name: string
  type: string // post:slack | post:http | create:jira | send:email | internal task:*/step:* actions
  config: Record<string, unknown>
  order: number
  enabled: boolean
  dryRun?: boolean
  consecutiveFailures: number
  lastError: string | null
}

export type IntegrationTrigger = {
  id: string
  name: string
  description?: string
  type: 'event' | 'poll:sentry'
  eventType?: string
  eventFilters: string
  pollConfig: string
  enabled: boolean
  lastFiredAt?: string
  reactions: Reaction[]
}

const EVENT_TYPES = [
  { value: 'chain-completed', label: 'Chain completed' },
  { value: 'step-failed', label: 'Step failed' },
  { value: 'task-created', label: 'Task created' },
  { value: 'step-reviewed', label: 'Step reviewed' },
  { value: 'task-stale', label: 'Task stale (sweep)' },
  { value: 'review-gate-stale', label: 'Review gate stale (sweep)' },
]

const REACTION_TYPES = [
  { value: 'post:slack', label: 'Post to Slack' },
  { value: 'post:http', label: 'HTTP request' },
  { value: 'create:jira', label: 'Create Jira issue' },
  { value: 'send:email', label: 'Send email' },
  // Internal actions (Epic S7): mutate Conductor state — no external service
  { value: 'task:assign', label: '⚙ Internal: assign agent' },
  { value: 'task:set-priority', label: '⚙ Internal: set priority' },
  { value: 'task:set-retry', label: '⚙ Internal: set retry policy' },
  { value: 'task:archive', label: '⚙ Internal: archive task' },
  { value: 'step:escalate', label: '⚙ Internal: escalate step' },
]

// Starter config per reaction type, shown when the type changes.
const CONFIG_HINTS: Record<string, string> = {
  'post:slack': '{"webhookEnvVar": "SLACK_WEBHOOK", "text": "Chain {{event.taskId}} completed"}',
  'post:http': '{"url": "https://example.com/hook", "method": "POST"}',
  'create:jira': '{"baseUrl": "https://org.atlassian.net", "projectKey": "OPS", "summary": "{{event.error}}"}',
  'send:email': '{"to": "team@example.com", "subject": "Step failed"}',
  'task:assign': '{"agentRole": "developer"}',
  'task:set-priority': '{"priority": "HIGH"}',
  'task:set-retry': '{"maxRetries": 5, "retryDelayMs": 10000}',
  'task:archive': '{}',
  'step:escalate': '{"bumpPriority": true, "reassignFallback": false}',
}

type Props = {
  projectId: string
  triggers: IntegrationTrigger[]
  onTriggersChange: (triggers: IntegrationTrigger[]) => void
}

function statusDot(trigger: IntegrationTrigger) {
  if (!trigger.enabled) return <span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />
  const hasErrors = trigger.reactions.some(r => r.consecutiveFailures > 0)
  if (hasErrors) return <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
  return <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
}

const INTERNAL_TYPES = new Set(['task:assign', 'task:set-priority', 'task:set-retry', 'task:archive', 'step:escalate'])
const AGENT_ROLES = ['developer', 'researcher', 'writer', 'support', 'qa', 'analyst']

// Structured config editor for internal actions (Epic S7 Phase 3). The JSON
// config string stays the source of truth — this form parses and writes back,
// so switching types or hand-editing elsewhere keeps working.
function InternalActionConfig({ type, configJson, onChange }: {
  type: string
  configJson: string
  onChange: (json: string) => void
}) {
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(configJson) } catch {}
  const set = (patch: Record<string, unknown>) => {
    const next = { ...config, ...patch }
    for (const key of Object.keys(next)) {
      if (next[key] === undefined || next[key] === '' || next[key] === false) delete next[key]
    }
    onChange(JSON.stringify(next))
  }

  if (type === 'task:archive') {
    return <p className="text-xs text-muted-foreground">No configuration needed — archives the event&apos;s task when it&apos;s DONE.</p>
  }

  if (type === 'task:assign') {
    return (
      <div className="space-y-2">
        <div>
          <Label>Agent role</Label>
          <Select value={(config.agentRole as string) || 'none'} onValueChange={v => set({ agentRole: v === 'none' ? undefined : v, agentId: undefined })}>
            <SelectTrigger><SelectValue placeholder="Pick a role" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— by id instead —</SelectItem>
              {AGENT_ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!config.agentRole && (
          <div>
            <Label>Agent id</Label>
            <Input value={(config.agentId as string) || ''} onChange={e => set({ agentId: e.target.value })} placeholder="agent id" />
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={config.force === true} onChange={e => set({ force: e.target.checked })} />
          Force — reassign even if the task already has an agent
        </label>
      </div>
    )
  }

  if (type === 'task:set-priority') {
    return (
      <div>
        <Label>Priority</Label>
        <Select value={(config.priority as string) || 'HIGH'} onValueChange={v => set({ priority: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(pr => <SelectItem key={pr} value={pr}>{pr}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (type === 'task:set-retry') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Max retries</Label>
          <Input type="number" min={0} max={20} value={String(config.maxRetries ?? 5)}
            onChange={e => set({ maxRetries: parseInt(e.target.value, 10) || 0 })} />
        </div>
        <div>
          <Label>Retry delay (ms)</Label>
          <Input type="number" min={0} value={String(config.retryDelayMs ?? 10000)}
            onChange={e => set({ retryDelayMs: parseInt(e.target.value, 10) || 0 })} />
        </div>
      </div>
    )
  }

  if (type === 'step:escalate') {
    return (
      <div className="space-y-1">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={config.bumpPriority === true} onChange={e => set({ bumpPriority: e.target.checked })} />
          Bump task priority one rung (LOW → MEDIUM → HIGH → URGENT)
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={config.reassignFallback === true} onChange={e => set({ reassignFallback: e.target.checked })} />
          Reassign the step to its fallback agent
        </label>
      </div>
    )
  }

  return null
}

function ReactionRow({
  reaction,
  triggerId,
  projectId,
  onUpdate,
  onDelete,
}: {
  reaction: Reaction
  triggerId: string
  projectId: string
  onUpdate: (r: Reaction) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [config, setConfig] = useState(JSON.stringify(reaction.config, null, 2))
  const [name, setName] = useState(reaction.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { toast } = useToast()

  const save = async () => {
    let parsedConfig: Record<string, unknown>
    try { parsedConfig = JSON.parse(config) } catch { toast({ title: 'Config is not valid JSON', variant: 'destructive' }); return }

    const res = await fetch(
      `/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config: parsedConfig }),
      },
    )
    if (!res.ok) return
    const updated = await res.json() as Reaction
    updated.config = parsedConfig
    onUpdate(updated)
    setEditing(false)
  }

  const remove = async () => {
    await fetch(`/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`, {
      method: 'DELETE',
    })
    onDelete(reaction.id)
  }

  const toggleEnabled = async () => {
    const res = await fetch(
      `/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !reaction.enabled }),
      },
    )
    if (!res.ok) return
    onUpdate({ ...reaction, enabled: !reaction.enabled })
  }

  const toggleDryRun = async () => {
    const res = await fetch(
      `/api/projects/${projectId}/triggers/${triggerId}/reactions/${reaction.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: !reaction.dryRun }),
      },
    )
    if (!res.ok) return
    onUpdate({ ...reaction, dryRun: !reaction.dryRun })
  }

  return (
    <div className="border rounded p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{reaction.name}</span>
          <Badge variant="outline">{reaction.type}</Badge>
          {reaction.dryRun && <Badge variant="outline" className="text-amber-500 border-amber-500/40">dry run</Badge>}
          <span className="text-muted-foreground">order {reaction.order}</span>
          {reaction.consecutiveFailures > 0 && (
            <Badge variant="destructive">{reaction.consecutiveFailures} failures</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleDryRun}
            title="Dry run: log what would happen, execute nothing"
            className={`text-[10px] font-mono px-2 py-1 rounded border ${
              reaction.dryRun
                ? 'text-amber-500 border-amber-500/40 bg-amber-500/10'
                : 'text-muted-foreground border-border/30 hover:border-border'
            }`}
          >
            dry
          </button>
          <Switch checked={reaction.enabled} onCheckedChange={toggleEnabled} />
          <Button variant="ghost" size="sm" onClick={() => setEditing(e => !e)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>Delete</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete reaction "${reaction.name}"?`}
        description="The reaction is removed from this trigger and will no longer run. This cannot be undone."
        confirmLabel="Delete reaction"
        onConfirm={() => { void remove() }}
      />
      {reaction.lastError && (
        <p className="text-destructive text-xs">Last error: {reaction.lastError}</p>
      )}
      {editing && (
        <div className="space-y-2 pt-2">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <Label>Config (JSON with mustache templates)</Label>
            <Textarea
              value={config}
              onChange={e => setConfig(e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function TriggerCard({
  trigger,
  projectId,
  onUpdate,
  onDelete,
}: {
  trigger: IntegrationTrigger
  projectId: string
  onUpdate: (t: IntegrationTrigger) => void
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [addingReaction, setAddingReaction] = useState(false)
  const [newRxnName, setNewRxnName] = useState('')
  const [newRxnType, setNewRxnType] = useState<string>('post:slack')
  const [newRxnConfig, setNewRxnConfig] = useState('{}')
  const [newRxnDryRun, setNewRxnDryRun] = useState(false)
  const [newRxnOrder, setNewRxnOrder] = useState(trigger.reactions.length)
  const [testing, setTesting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { toast } = useToast()

  const toggleEnabled = async () => {
    const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !trigger.enabled }),
    })
    if (!res.ok) return
    onUpdate({ ...trigger, enabled: !trigger.enabled })
  }

  const removeTrigger = async () => {
    await fetch(`/api/projects/${projectId}/triggers/${trigger.id}`, { method: 'DELETE' })
    onDelete(trigger.id)
  }

  const testFire = async () => {
    setTesting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: {} }),
      })
      if (res.ok) toast({ title: 'Test fired successfully' })
      else {
        const err = await res.json() as { error?: string }
        toast({ title: `Test failed: ${err.error ?? 'Unknown error'}`, variant: 'destructive' })
      }
    } finally {
      setTesting(false)
    }
  }

  const addReaction = async () => {
    let parsedConfig: Record<string, unknown>
    try { parsedConfig = JSON.parse(newRxnConfig) } catch { toast({ title: 'Config is not valid JSON', variant: 'destructive' }); return }

    const res = await fetch(`/api/projects/${projectId}/triggers/${trigger.id}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newRxnName, type: newRxnType, config: parsedConfig, order: newRxnOrder, dryRun: newRxnDryRun }),
    })
    if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? 'Failed to add reaction', variant: 'destructive' }); return }
    const created = await res.json() as Reaction
    created.config = parsedConfig
    onUpdate({ ...trigger, reactions: [...trigger.reactions, created] })
    setAddingReaction(false)
    setNewRxnName('')
    setNewRxnConfig('{}')
    setNewRxnDryRun(false)
    setNewRxnOrder(trigger.reactions.length + 1)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger className="flex items-center gap-2 flex-1 text-left">
          {statusDot(trigger)}
          <span className="font-medium">{trigger.name}</span>
          <Badge variant="outline">{trigger.type === 'poll:sentry' ? 'Sentry poll' : trigger.eventType}</Badge>
          <span className="text-muted-foreground text-xs">{trigger.reactions.length} reactions</span>
        </CollapsibleTrigger>
        <div className="flex items-center gap-2">
          <Switch checked={trigger.enabled} onCheckedChange={toggleEnabled} />
          <Button variant="outline" size="sm" disabled={testing} onClick={testFire}>
            {testing ? 'Testing…' : 'Test'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>Delete</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete trigger "${trigger.name}"?`}
        description="The trigger and all of its reactions are removed and will no longer fire. This cannot be undone."
        confirmLabel="Delete trigger"
        onConfirm={() => { void removeTrigger() }}
      />

      <CollapsibleContent className="space-y-2 pt-2">
        <div className="space-y-2">
          {trigger.reactions.map(r => (
            <ReactionRow
              key={r.id}
              reaction={r}
              triggerId={trigger.id}
              projectId={projectId}
              onUpdate={updated =>
                onUpdate({ ...trigger, reactions: trigger.reactions.map(x => x.id === updated.id ? updated : x) })
              }
              onDelete={id => onUpdate({ ...trigger, reactions: trigger.reactions.filter(x => x.id !== id) })}
            />
          ))}
        </div>

        {addingReaction ? (
          <div className="border rounded p-3 space-y-2 text-sm">
            <p className="font-medium">New reaction</p>
            <div>
              <Label>Name</Label>
              <Input value={newRxnName} onChange={e => setNewRxnName(e.target.value)} placeholder="Notify Slack" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={newRxnType} onValueChange={(v) => { setNewRxnType(v); if (newRxnConfig === '{}' || Object.values(CONFIG_HINTS).includes(newRxnConfig)) setNewRxnConfig(CONFIG_HINTS[v] ?? '{}') }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REACTION_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Order</Label>
              <Input type="number" value={newRxnOrder} onChange={e => setNewRxnOrder(Number(e.target.value))} />
            </div>
            {INTERNAL_TYPES.has(newRxnType) ? (
              <div>
                <Label>Action settings</Label>
                <div className="mt-1">
                  <InternalActionConfig type={newRxnType} configJson={newRxnConfig} onChange={setNewRxnConfig} />
                </div>
              </div>
            ) : (
              <div>
                <Label>Config (JSON)</Label>
                <Textarea
                  value={newRxnConfig}
                  onChange={e => setNewRxnConfig(e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                  placeholder='{"webhookEnvVar": "SLACK_WEBHOOK", "text": "Chain {{event.taskId}} completed"}'
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={newRxnDryRun} onChange={e => setNewRxnDryRun(e.target.checked)} />
              Dry run — log what would happen, execute nothing
            </label>
            <div className="flex gap-2">
              <Button size="sm" onClick={addReaction}>Add reaction</Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingReaction(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAddingReaction(true)}>+ Add reaction</Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsIntegrations({ projectId, triggers, onTriggersChange }: Props) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'event' | 'poll:sentry'>('event')
  const [newEventType, setNewEventType] = useState('chain-completed')
  const [newPollConfig, setNewPollConfig] = useState('{}')
  const { toast } = useToast()

  const createTrigger = async () => {
    const body: Record<string, unknown> = { name: newName, type: newType }
    if (newType === 'event') {
      body.eventType = newEventType
    } else {
      try { body.pollConfig = JSON.parse(newPollConfig) } catch { toast({ title: 'Poll config is not valid JSON', variant: 'destructive' }); return }
    }

    const res = await fetch(`/api/projects/${projectId}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const e = await res.json() as { error?: string }; toast({ title: e.error ?? 'Failed to create trigger', variant: 'destructive' }); return }
    const created = await res.json() as IntegrationTrigger
    onTriggersChange([...triggers, created])
    setCreating(false)
    setNewName('')
    setNewPollConfig('{}')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Integrations</h3>
        <Button size="sm" onClick={() => setCreating(c => !c)}>+ New trigger</Button>
      </div>

      {creating && (
        <div className="border rounded p-4 space-y-3 text-sm">
          <p className="font-medium">New trigger</p>
          <div>
            <Label>Name</Label>
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Chain done → Slack" />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={newType} onValueChange={v => setNewType(v as 'event' | 'poll:sentry')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="event">Internal event</SelectItem>
                <SelectItem value="poll:sentry">Sentry poll</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {newType === 'event' && (
            <div>
              <Label>Event type</Label>
              <Select value={newEventType} onValueChange={setNewEventType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {newType === 'poll:sentry' && (
            <div>
              <Label>Poll config (JSON)</Label>
              <Textarea
                value={newPollConfig}
                onChange={e => setNewPollConfig(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder='{"apiTokenEnvVar": "SENTRY_TOKEN", "orgSlug": "acme", "projectSlug": "backend"}'
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={createTrigger}>Create</Button>
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {triggers.length === 0 && !creating && (
        <p className="text-muted-foreground text-sm">No triggers yet. Create one to start automating reactions.</p>
      )}

      <div className="space-y-2">
        {triggers.map(t => (
          <TriggerCard
            key={t.id}
            trigger={t}
            projectId={projectId}
            onUpdate={updated => onTriggersChange(triggers.map(x => x.id === updated.id ? updated : x))}
            onDelete={id => onTriggersChange(triggers.filter(x => x.id !== id))}
          />
        ))}
      </div>
    </div>
  )
}
