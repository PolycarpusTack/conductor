'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Play, Square, Clock, Zap, Calendar, Hand } from 'lucide-react'

interface AutomationConfig {
  automationMode: string
  automationSchedule: {
    startDay: number
    startTime: string
    endDay: number
    endTime: string
  } | null
  automationPollMs: number
  running: boolean
}

interface SettingsAutomationProps {
  projectId: string
}

const DAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
]

const POLL_INTERVALS = [
  { value: '3000', label: '3 seconds' },
  { value: '5000', label: '5 seconds' },
  { value: '10000', label: '10 seconds' },
  { value: '30000', label: '30 seconds' },
  { value: '60000', label: '1 minute' },
  { value: '300000', label: '5 minutes' },
]

const MODE_DESCRIPTIONS: Record<string, { label: string; description: string; icon: typeof Play }> = {
  manual: { label: 'Manual', description: 'Start and stop manually using the controls below', icon: Hand },
  always: { label: 'Always On', description: 'Runs continuously whenever the application is running', icon: Zap },
  startup: { label: 'Start on Boot', description: 'Starts automatically when the application launches', icon: Play },
  scheduled: { label: 'Scheduled', description: 'Runs during a configured time window each week', icon: Calendar },
}

export function SettingsAutomation({ projectId }: SettingsAutomationProps) {
  const [config, setConfig] = useState<AutomationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Time-based rules (Epic S7 Phase 2): blank = sweep off
  const [autoArchiveDays, setAutoArchiveDays] = useState('')
  const [reviewEscalationHours, setReviewEscalationHours] = useState('')
  const [savingSweep, setSavingSweep] = useState(false)
  const [sweepSaved, setSweepSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/projects/${projectId}`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return
        setAutoArchiveDays(data.autoArchiveDays != null ? String(data.autoArchiveDays) : '')
        setReviewEscalationHours(data.reviewEscalationHours != null ? String(data.reviewEscalationHours) : '')
      })
      .catch(() => {})
  }, [projectId])

  // Recurring tasks: instantiate a task template on a cadence
  interface Recurrence {
    id: string
    name: string
    cadence: string
    dayOfWeek: number | null
    dayOfMonth: number | null
    timeOfDay: string
    enabled: boolean
    nextRunAt: string
    taskTemplate: { id: string; name: string; icon: string | null }
  }
  const [recurrences, setRecurrences] = useState<Recurrence[]>([])
  const [taskTemplates, setTaskTemplates] = useState<Array<{ id: string; name: string; icon: string | null }>>([])
  const [addingRecurrence, setAddingRecurrence] = useState(false)
  const [recName, setRecName] = useState('')
  const [recTemplateId, setRecTemplateId] = useState('')
  const [recCadence, setRecCadence] = useState('daily')
  const [recDayOfWeek, setRecDayOfWeek] = useState('1')
  const [recDayOfMonth, setRecDayOfMonth] = useState('1')
  const [recTime, setRecTime] = useState('09:00')
  const [recError, setRecError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/projects/${projectId}/recurring-tasks`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : [])
      .then((data) => { if (Array.isArray(data)) setRecurrences(data) })
      .catch(() => {})
    fetch(`/api/projects/${projectId}/task-templates`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : [])
      .then((data) => { if (Array.isArray(data)) setTaskTemplates(data) })
      .catch(() => {})
  }, [projectId])

  const addRecurrence = async () => {
    setRecError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/recurring-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: recName,
          taskTemplateId: recTemplateId,
          cadence: recCadence,
          dayOfWeek: recCadence === 'weekly' ? Number(recDayOfWeek) : undefined,
          dayOfMonth: recCadence === 'monthly' ? Number(recDayOfMonth) : undefined,
          timeOfDay: recTime,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create recurrence')
      const created = await res.json()
      setRecurrences(prev => [...prev, created])
      setAddingRecurrence(false)
      setRecName('')
      setRecTemplateId('')
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Failed to create')
    }
  }

  const toggleRecurrence = async (rec: Recurrence) => {
    const res = await fetch(`/api/projects/${projectId}/recurring-tasks/${rec.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rec.enabled }),
    })
    if (res.ok) {
      const updated = await res.json()
      setRecurrences(prev => prev.map(r => r.id === rec.id ? updated : r))
    }
  }

  const deleteRecurrence = async (recId: string) => {
    const res = await fetch(`/api/projects/${projectId}/recurring-tasks/${recId}`, { method: 'DELETE' })
    if (res.ok) setRecurrences(prev => prev.filter(r => r.id !== recId))
  }

  const cadenceSummary = (rec: Recurrence) => {
    if (rec.cadence === 'weekly') return `${DAYS[rec.dayOfWeek ?? 1]?.label}s at ${rec.timeOfDay}`
    if (rec.cadence === 'monthly') return `day ${rec.dayOfMonth} monthly at ${rec.timeOfDay}`
    return `daily at ${rec.timeOfDay}`
  }

  // Recent automation activity (Epic S7 Phase 3) — what the rules actually did
  const [ruleActivity, setRuleActivity] = useState<Array<{
    id: string; action: string; details: string | null; createdAt: string
  }>>([])

  useEffect(() => {
    fetch(`/api/activity?projectId=${projectId}&component=automation&limit=15`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : [])
      .then((entries) => { if (Array.isArray(entries)) setRuleActivity(entries) })
      .catch(() => {})
  }, [projectId])

  const describeRule = (entry: { details: string | null }) => {
    try {
      const d = JSON.parse(entry.details || '{}')
      const action = d.ruleAction || 'rule'
      const target = d.agentName || d.to || d.bumpedPriority || d.reassignedTo
        || (d.maxRetries != null ? `maxRetries ${d.maxRetries}` : null)
      return target ? `${action} → ${target}` : action
    } catch {
      return 'rule fired'
    }
  }

  const saveSweepSettings = async () => {
    setSavingSweep(true)
    setSweepSaved(false)
    try {
      const days = parseInt(autoArchiveDays, 10)
      const hours = parseInt(reviewEscalationHours, 10)
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoArchiveDays: Number.isFinite(days) && days >= 1 ? days : null,
          reviewEscalationHours: Number.isFinite(hours) && hours >= 1 ? hours : null,
        }),
      })
      if (res.ok) {
        setSweepSaved(true)
        setTimeout(() => setSweepSaved(false), 2000)
      }
    } catch (err) {
      console.error('Failed to save sweep settings:', err)
    } finally {
      setSavingSweep(false)
    }
  }

  // Editable state
  const [mode, setMode] = useState('manual')
  const [pollMs, setPollMs] = useState('10000')
  const [startDay, setStartDay] = useState('1')
  const [startTime, setStartTime] = useState('08:00')
  const [endDay, setEndDay] = useState('5')
  const [endTime, setEndTime] = useState('18:00')

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/automation`, { cache: 'no-store' })
      if (res.ok) {
        const data: AutomationConfig = await res.json()
        setConfig(data)
        setMode(data.automationMode)
        setPollMs(String(data.automationPollMs))
        if (data.automationSchedule) {
          setStartDay(String(data.automationSchedule.startDay))
          setStartTime(data.automationSchedule.startTime)
          setEndDay(String(data.automationSchedule.endDay))
          setEndTime(data.automationSchedule.endTime)
        }
      }
    } catch (err) {
      console.error('Failed to fetch automation config:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Poll for status updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(fetchConfig, 5000)
    return () => clearInterval(interval)
  }, [fetchConfig])

  const saveConfig = async () => {
    setSaving(true)
    try {
      const schedule = mode === 'scheduled' ? {
        startDay: Number(startDay),
        startTime,
        endDay: Number(endDay),
        endTime,
      } : null

      await fetch(`/api/projects/${projectId}/automation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          schedule,
          pollMs: Number(pollMs),
        }),
      })
      await fetchConfig()
    } catch (err) {
      console.error('Failed to save automation config:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleManualAction = async (action: 'start' | 'stop') => {
    try {
      await fetch(`/api/projects/${projectId}/automation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await fetchConfig()
    } catch (err) {
      console.error(`Failed to ${action} automation:`, err)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading automation settings...</div>
  }

  const isRunning = config?.running ?? false

  return (
    <div className="space-y-6">
      {/* Status indicator */}
      <div className={`flex items-center gap-3 p-3 rounded-lg border ${
        isRunning
          ? 'border-[var(--op-green-dim,rgba(74,222,128,0.2))] bg-[var(--op-green-bg,rgba(74,222,128,0.05))]'
          : 'border-border/30 bg-muted/20'
      }`}>
        <div className={`h-2.5 w-2.5 rounded-full ${isRunning ? 'bg-[var(--op-green)] animate-pulse' : 'bg-muted-foreground/30'}`} />
        <div>
          <div className="text-sm font-medium">{isRunning ? 'Automation Running' : 'Automation Stopped'}</div>
          <div className="text-xs text-muted-foreground">
            {isRunning
              ? `Polling every ${Number(pollMs) / 1000}s — dispatching active steps to agents`
              : 'No steps are being dispatched. Start automation to process queued work.'}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {isRunning ? (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 border-destructive/30 text-destructive"
              onClick={() => handleManualAction('stop')}
            >
              <Square className="h-3 w-3 mr-1" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="text-xs h-7 bg-[var(--op-green)] text-background hover:bg-[var(--op-green)]/90"
              onClick={() => handleManualAction('start')}
            >
              <Play className="h-3 w-3 mr-1" />
              Start
            </Button>
          )}
        </div>
      </div>

      {/* Mode selection */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Automation Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(MODE_DESCRIPTIONS).map(([key, { label, description, icon: Icon }]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                mode === key
                  ? 'border-primary bg-primary/5'
                  : 'border-border/30 hover:border-border/60'
              }`}
            >
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${mode === key ? 'text-primary' : 'text-muted-foreground'}`} />
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[11px] text-muted-foreground leading-tight">{description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Schedule config (only visible in scheduled mode) */}
      {mode === 'scheduled' && (
        <div className="space-y-3 p-3 rounded-lg border border-border/30 bg-muted/10">
          <label className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            Schedule Window
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Start</label>
              <div className="flex gap-2">
                <Select value={startDay} onValueChange={setStartDay}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => (
                      <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="h-8 text-xs w-24"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">End</label>
              <div className="flex gap-2">
                <Select value={endDay} onValueChange={setEndDay}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => (
                      <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="h-8 text-xs w-24"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Poll interval */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Poll Interval</label>
        <Select value={pollMs} onValueChange={setPollMs}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLL_INTERVALS.map(p => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">How often to check for active steps and dispatch them to agents</p>
      </div>

      {/* Save button */}
      <Button
        size="sm"
        onClick={saveConfig}
        disabled={saving}
        className="w-full"
      >
        {saving ? 'Saving...' : 'Save Automation Settings'}
      </Button>

      {/* Time-based rules (Epic S7 Phase 2) */}
      <div className="space-y-3 p-3 rounded-lg border border-border/30 bg-muted/10">
        <label className="text-sm font-medium">Time-Based Rules</label>
        <p className="text-[11px] text-muted-foreground">
          An hourly sweep emits <code>task-stale</code> and <code>review-gate-stale</code> events for
          old work. Pair them with a trigger in the Integrations tab (e.g. <code>task-stale</code> →
          internal action <code>task:archive</code>) to act on them. Blank = off.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Flag DONE tasks idle for (days)</label>
            <Input
              type="number" min={1} max={3650}
              value={autoArchiveDays}
              onChange={e => setAutoArchiveDays(e.target.value)}
              placeholder="Off"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Flag human gates waiting over (hours)</label>
            <Input
              type="number" min={1} max={720}
              value={reviewEscalationHours}
              onChange={e => setReviewEscalationHours(e.target.value)}
              placeholder="Off"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={saveSweepSettings} disabled={savingSweep} className="w-full">
          {savingSweep ? 'Saving...' : sweepSaved ? 'Saved ✓' : 'Save Time-Based Rules'}
        </Button>
      </div>

      {/* Recurring tasks */}
      <div className="space-y-3 p-3 rounded-lg border border-border/30 bg-muted/10">
        <label className="text-sm font-medium">Recurring Tasks</label>
        <p className="text-[11px] text-muted-foreground">
          Create a task from a <strong>task template</strong> on a schedule. Chains attached to the
          template start automatically with agents resolved by role.
        </p>

        {recurrences.map((rec) => (
          <div key={rec.id} className="flex items-center gap-2 text-xs p-2 rounded bg-background/50">
            <span className="shrink-0">{rec.taskTemplate?.icon || '📋'}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{rec.name}</div>
              <div className="text-muted-foreground text-[10px]">
                {cadenceSummary(rec)} · next {new Date(rec.nextRunAt).toLocaleString()}
              </div>
            </div>
            <button
              onClick={() => toggleRecurrence(rec)}
              className={`text-[10px] font-mono px-2 py-1 rounded border shrink-0 ${
                rec.enabled
                  ? 'bg-[var(--op-green-bg,rgba(74,222,128,0.1))] text-[var(--op-green,#4ADE80)] border-[var(--op-green-dim,rgba(74,222,128,0.2))]'
                  : 'text-muted-foreground border-border/30'
              }`}
            >
              {rec.enabled ? 'on' : 'off'}
            </button>
            <Button variant="ghost" size="sm" className="h-6 text-xs shrink-0" onClick={() => deleteRecurrence(rec.id)}>
              Delete
            </Button>
          </div>
        ))}

        {addingRecurrence ? (
          <div className="space-y-2 p-2 rounded border border-border/20">
            {recError && <p className="text-xs text-destructive">{recError}</p>}
            <Input value={recName} onChange={e => setRecName(e.target.value)} placeholder="Recurrence name" className="h-8 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <Select value={recTemplateId || 'none'} onValueChange={v => setRecTemplateId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Task template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Pick a template…</SelectItem>
                  {taskTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">{t.icon || '📋'} {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={recCadence} onValueChange={setRecCadence}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily" className="text-xs">Daily</SelectItem>
                  <SelectItem value="weekly" className="text-xs">Weekly</SelectItem>
                  <SelectItem value="monthly" className="text-xs">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {recCadence === 'weekly' && (
                <Select value={recDayOfWeek} onValueChange={setRecDayOfWeek}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map(d => <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {recCadence === 'monthly' && (
                <Input type="number" min={1} max={28} value={recDayOfMonth}
                  onChange={e => setRecDayOfMonth(e.target.value)} placeholder="Day of month" className="h-8 text-xs" />
              )}
              <Input type="time" value={recTime} onChange={e => setRecTime(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={addRecurrence} disabled={!recName.trim() || !recTemplateId}>
                Add
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingRecurrence(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : taskTemplates.length > 0 ? (
          <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => setAddingRecurrence(true)}>
            + Add Recurring Task
          </Button>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No task templates yet — create one in <strong>Settings → Templates</strong> first.
          </p>
        )}
      </div>

      {/* Recent automation activity (Epic S7 Phase 3) */}
      <div className="space-y-2 p-3 rounded-lg border border-border/30 bg-muted/10">
        <label className="text-sm font-medium">Recent Automation Activity</label>
        {ruleActivity.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nothing yet — when an automation rule fires (an internal action on a trigger), it logs here
            as <code>automation_rule_fired</code>.
          </p>
        ) : (
          <div className="space-y-1">
            {ruleActivity.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-background/50">
                <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px]">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
                <span className="truncate">{describeRule(entry)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
