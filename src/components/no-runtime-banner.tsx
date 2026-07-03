'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NoRuntimeBannerProps {
  projectId: string
  hasAgents: boolean
  hasRuntimes: boolean
  /** Opens the settings dialog on the given tab (the existing settings-open mechanism). */
  onOpenSettings: (tab: 'runtimes' | 'agents') => void
}

const dismissKey = (projectId: string) => `conductor.dispatch-warning.dismissed.${projectId}`

/**
 * C-5: board-level amber banner shown when the project cannot dispatch
 * anything — either no runtime is configured (agents are silently skipped by
 * the dispatcher) or the project has no agents at all. Dismissible per
 * session and per project. Mount with `key={projectId}` so dismissal state
 * resets on project switch.
 */
export function NoRuntimeBanner({ projectId, hasAgents, hasRuntimes, onOpenSettings }: NoRuntimeBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(dismissKey(projectId)) === '1'
    } catch {
      return false
    }
  })

  if (dismissed || (hasRuntimes && hasAgents)) return null

  const missingRuntime = !hasRuntimes

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(dismissKey(projectId), '1')
    } catch {
      // storage unavailable — dismissal still holds for this mount
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] px-4 py-2">
      <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--op-amber)]" />
      <p className="flex-1 min-w-0 text-xs leading-relaxed text-foreground/75">
        <span className="font-medium text-[var(--op-amber)]">
          {missingRuntime ? 'No runtime configured' : 'No agents configured'}
        </span>
        {' — '}
        {missingRuntime
          ? 'agents will be silently skipped by the dispatcher'
          : 'the dispatcher has nothing to run'}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 shrink-0 text-xs border-[var(--op-amber-dim)] hover:bg-[var(--op-amber)]/10"
        onClick={() => onOpenSettings(missingRuntime ? 'runtimes' : 'agents')}
      >
        {missingRuntime ? 'Go to Runtimes →' : 'Go to Agents →'}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={dismiss}
        aria-label="Dismiss warning"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
