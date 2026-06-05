'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MessageSquare, Send, ShieldAlert } from 'lucide-react'

interface TaskMessage {
  id: string
  threadId: string | null
  fromAddress: string
  toAddress: string
  priority: string
  subject: string | null
  body: string
  bodySecurity: { trust?: string; flags?: Array<{ category: string }> } | null
  status: string
  createdAt: string
  readAt: string | null
}

interface TaskMessagesProps {
  taskId: string
  agents: Array<{ id: string; name: string }>
}

const PRIORITY_STYLES: Record<string, string> = {
  low: 'text-muted-foreground',
  normal: '',
  high: 'text-[var(--op-amber,#F59E0B)]',
  urgent: 'text-[var(--op-red,#F87171)]',
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Task-scoped message thread with an admin send box — task drawer section. */
export function TaskMessages({ taskId, agents }: TaskMessagesProps) {
  const [messages, setMessages] = useState<TaskMessage[]>([])
  const [composing, setComposing] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/messages`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setMessages(data.messages)
      }
    } catch {
      // informational section — keep previous state
    }
  }, [taskId])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  const send = async () => {
    if (!recipient || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, body }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || 'Failed to send message')
        return
      }
      setBody('')
      setComposing(false)
      await fetchMessages()
    } catch {
      setError('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  if (messages.length === 0 && !composing) {
    return (
      <button
        onClick={() => setComposing(true)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        Message an agent about this task
      </button>
    )
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <MessageSquare className="h-3 w-3" />
        Messages
      </h3>

      <div className="space-y-2">
        {messages.map((m) => {
          const flagged = (m.bodySecurity?.flags?.length ?? 0) > 0
          return (
            <div key={m.id} className="rounded border border-border/30 bg-card/40 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0 text-[11px] font-mono">
                  <span className="font-semibold truncate">{m.fromAddress}</span>
                  <span className="text-muted-foreground/50">→</span>
                  <span className="truncate">{m.toAddress}</span>
                  {m.priority !== 'normal' && (
                    <span className={`uppercase text-[9px] ${PRIORITY_STYLES[m.priority] || ''}`}>{m.priority}</span>
                  )}
                  {flagged && (
                    <Badge variant="outline" className="gap-1 text-[9px] bg-[var(--op-red-bg,rgba(248,113,113,0.1))] text-[var(--op-red,#F87171)] border-[var(--op-red-dim,rgba(248,113,113,0.2))]">
                      <ShieldAlert className="h-2.5 w-2.5" />
                      flagged
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/50 shrink-0">
                  {relativeTime(m.createdAt)} · {m.status}
                </span>
              </div>
              {m.subject && <p className="text-xs font-medium mb-0.5">{m.subject}</p>}
              <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{m.body}</p>
            </div>
          )
        })}
      </div>

      {composing ? (
        <div className="mt-2 space-y-2">
          <Select value={recipient} onValueChange={setRecipient}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="To agent…" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={slugify(a.name)} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Message…"
            className="text-xs min-h-[60px]"
          />
          {error && <p className="text-[11px] text-[var(--op-red,#F87171)]">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" disabled={sending || !recipient || !body.trim()} onClick={send}>
              <Send className="mr-1 h-3 w-3" />
              Send
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 text-xs mt-2" onClick={() => setComposing(true)}>
          <Send className="mr-1 h-3 w-3" />
          New message
        </Button>
      )}
    </div>
  )
}
