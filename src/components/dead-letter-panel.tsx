'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface DeadLetter {
  id: string
  originalStepId: string
  taskId: string
  taskTitle: string | null
  agentId: string | null
  mode: string
  instructions: string | null
  attempts: number
  lastError: string | null
  movedAt: string
}

interface DeadLetterPanelProps {
  projectId: string
}

/** Exhausted steps parked in the dead-letter table, with one-click requeue. */
export function DeadLetterPanel({ projectId }: DeadLetterPanelProps) {
  const { toast } = useToast()
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([])
  const [loading, setLoading] = useState(true)
  const [requeuingId, setRequeuingId] = useState<string | null>(null)

  const fetchDeadLetters = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/dead-letters`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setDeadLetters(data.deadLetters)
      }
    } catch {
      // panel is informational — leave the previous list on a failed refresh
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { fetchDeadLetters() }, [fetchDeadLetters])

  const requeue = async (deadLetterId: string) => {
    setRequeuingId(deadLetterId)
    try {
      const res = await fetch(`/api/projects/${projectId}/dead-letters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadLetterId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast({ title: data?.error || 'Failed to requeue step', variant: 'destructive' })
        return
      }
      setDeadLetters(prev => prev.filter(dl => dl.id !== deadLetterId))
      toast({ title: 'Step requeued for a fresh retry cycle' })
    } catch {
      toast({ title: 'Failed to requeue step', variant: 'destructive' })
    } finally {
      setRequeuingId(null)
    }
  }

  if (!loading && deadLetters.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--op-red-dim,rgba(248,113,113,0.2))] bg-[var(--op-red-bg,rgba(248,113,113,0.05))] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--op-red,#F87171)]" />
          <span className="text-sm font-medium">
            Dead-lettered steps
            <span className="ml-2 text-xs text-muted-foreground">{deadLetters.length}</span>
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchDeadLetters}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="space-y-2">
        {deadLetters.map((dl) => (
          <div key={dl.id} className="rounded border border-border/30 bg-card/50 p-2.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {dl.taskTitle || dl.taskId}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">{dl.mode}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {dl.attempts} attempt{dl.attempts !== 1 ? 's' : ''} · {new Date(dl.movedAt).toLocaleString()}
              </div>
              {dl.lastError && (
                <div className="text-[11px] text-[var(--op-red,#F87171)]/80 mt-1 line-clamp-2">{dl.lastError}</div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              disabled={requeuingId === dl.id}
              onClick={() => requeue(dl.id)}
            >
              <RotateCcw className={`mr-1 h-3 w-3 ${requeuingId === dl.id ? 'animate-spin' : ''}`} />
              Requeue
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
