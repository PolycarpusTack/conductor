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
    </div>
  )
}
