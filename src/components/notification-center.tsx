'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, CheckCheck, ShieldAlert, UserCheck, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// TODO(C-4 wiring, parent session): mount in board-header.tsx as
//   <NotificationCenter projectId={projectId} onTaskClick={(taskId) => openTaskDrawer(taskId)} />
// and (optionally) bump `refreshSignal` when the 'notification-created'
// realtime event arrives so the badge updates without a poll.

export interface NotificationItem {
  id: string
  projectId: string | null
  type: string // review_gate_waiting | dead_letter | budget_exceeded
  title: string
  body: string | null
  taskId: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationCenterProps {
  /** Project whose notifications are listed. */
  projectId: string
  /** Called with the task id when a task-linked notification is clicked (open the task drawer). */
  onTaskClick?: (taskId: string) => void
  /** Optional: bump to force a refetch (e.g. on the 'notification-created' realtime event). */
  refreshSignal?: number
  className?: string
}

const TYPE_META: Record<string, { icon: typeof Bell; className: string; label: string }> = {
  review_gate_waiting: {
    icon: UserCheck,
    className: 'text-[var(--op-blue,#60A5FA)] bg-[var(--op-blue-bg,rgba(96,165,250,0.1))]',
    label: 'Review',
  },
  dead_letter: {
    icon: ShieldAlert,
    className: 'text-[var(--op-red,#F87171)] bg-[var(--op-red-bg,rgba(248,113,113,0.1))]',
    label: 'Dead letter',
  },
  budget_exceeded: {
    icon: Wallet,
    className: 'text-[var(--op-amber,#F59E0B)] bg-[var(--op-amber-bg,rgba(245,158,11,0.1))]',
    label: 'Budget',
  },
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Bell popover with the project's notifications (unread first): type icon,
 * title, relative time; click marks read and follows a task link when
 * present. Standalone — fetches its own data from
 * /api/projects/[id]/notifications.
 */
export function NotificationCenter({ projectId, onTaskClick, refreshSignal, className }: NotificationCenterProps) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/notifications`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications ?? [])
        setUnreadCount(data.unreadCount ?? 0)
      }
    } catch {
      // informational surface — keep previous state
    }
  }, [projectId])

  // Fetch on mount, on refreshSignal bumps, and whenever the popover opens.
  useEffect(() => {
    const load = async () => {
      await fetchNotifications()
    }
    void load()
  }, [fetchNotifications, refreshSignal])

  useEffect(() => {
    if (!open) return
    const load = async () => {
      await fetchNotifications()
    }
    void load()
  }, [open, fetchNotifications])

  const markRead = useCallback(
    async (payload: { id: string } | { all: true }) => {
      // Optimistic: flip locally, reconcile with a refetch.
      const now = new Date().toISOString()
      setNotifications((prev) =>
        prev.map((n) =>
          ('all' in payload || n.id === payload.id) && !n.readAt ? { ...n, readAt: now } : n,
        ),
      )
      setUnreadCount((prev) => ('all' in payload ? 0 : Math.max(0, prev - 1)))
      try {
        await fetch(`/api/projects/${projectId}/notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch {
        // reconciled below either way
      }
      fetchNotifications()
    },
    [projectId, fetchNotifications],
  )

  const handleItemClick = (notification: NotificationItem) => {
    if (!notification.readAt) markRead({ id: notification.id })
    if (notification.taskId && onTaskClick) {
      onTaskClick(notification.taskId)
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative h-8 w-8 ${className ?? ''}`}
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--op-red,#F87171)] px-1 text-[9px] font-semibold leading-none text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Notifications
          </span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => markRead({ all: true })}
            >
              <CheckCheck className="h-3 w-3" />
              Mark all read
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground/60">
            Nothing needs your attention.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {notifications.map((notification) => {
              const meta = TYPE_META[notification.type] ?? {
                icon: Bell,
                className: 'text-muted-foreground bg-muted/40',
                label: notification.type,
              }
              const Icon = meta.icon
              const unread = !notification.readAt
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(notification)}
                    className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/50 ${
                      unread ? '' : 'opacity-60'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${meta.className}`}
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-xs ${unread ? 'font-semibold' : 'font-medium'}`}>
                          {notification.title}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground/60">
                          {relativeTime(notification.createdAt)}
                        </span>
                      </span>
                      {notification.body && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2">
                          {notification.body}
                        </span>
                      )}
                    </span>
                    {unread && (
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--op-blue,#60A5FA)]"
                        aria-label="unread"
                      />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
