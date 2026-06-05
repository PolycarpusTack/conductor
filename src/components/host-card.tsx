'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RefreshCw, Monitor, Wifi, WifiOff, AlertTriangle, Shield } from 'lucide-react'

export interface HostSummary {
  id: string
  workspaceId: string
  slug: string
  displayName: string
  hostname: string
  platform: string
  arch: string | null
  labels: string[]
  trustLevel: string
  status: 'online' | 'stale' | 'offline'
  lastSeenAt: string | null
  daemonCount: number
  onlineDaemons: number
  capabilities: string[]
}

const STATUS_STYLES: Record<string, { icon: React.ReactNode; className: string }> = {
  online: { icon: <Wifi className="w-3.5 h-3.5" />, className: 'bg-green-500/15 text-green-600 border-green-500/30' },
  stale: { icon: <AlertTriangle className="w-3.5 h-3.5" />, className: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
  offline: { icon: <WifiOff className="w-3.5 h-3.5" />, className: 'bg-red-500/15 text-red-600 border-red-500/30' },
}

const PLATFORM_LABELS: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
}

const TRUST_STYLES: Record<string, string> = {
  local: 'bg-green-500/10 text-green-600',
  lan: 'bg-blue-500/10 text-blue-500',
  remote: 'bg-yellow-500/10 text-yellow-600',
  cloud: 'bg-purple-500/10 text-purple-500',
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function HostCard({ host }: { host: HostSummary }) {
  const style = STATUS_STYLES[host.status] || STATUS_STYLES.offline

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`gap-1 ${style.className}`}>
              {style.icon}
              {host.status}
            </Badge>
            <div>
              <CardTitle className="text-sm font-medium">{host.displayName}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {host.hostname} · {PLATFORM_LABELS[host.platform] || host.platform}
                {host.arch ? ` / ${host.arch}` : ''}
                {host.lastSeenAt ? ` · ${relativeTime(host.lastSeenAt)}` : ''}
              </p>
            </div>
          </div>
          <Badge variant="secondary" className={`gap-1 text-[10px] ${TRUST_STYLES[host.trustLevel] || ''}`}>
            <Shield className="w-3 h-3" />
            {host.trustLevel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3 px-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            {host.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>
            ))}
            {host.labels.map((l) => (
              <Badge key={l} variant="outline" className="text-[10px]">{l}</Badge>
            ))}
          </div>
          <span className="text-muted-foreground shrink-0">
            {host.onlineDaemons}/{host.daemonCount} daemon{host.daemonCount !== 1 ? 's' : ''} online
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/** Self-contained hosts list with polling — the Hosts tab of the Runtime Dashboard. */
export function HostsPanel() {
  const [hosts, setHosts] = useState<HostSummary[] | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchHosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/hosts', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setHosts(data.hosts)
      }
    } catch {
      // keep previous list on transient failure
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHosts()
    const interval = setInterval(fetchHosts, 15_000)
    return () => clearInterval(interval)
  }, [fetchHosts])

  if (hosts === null) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        Loading hosts...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Hosts</h3>
        <Button variant="ghost" size="sm" onClick={fetchHosts} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {hosts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm space-y-1">
            <Monitor className="w-5 h-5 mx-auto mb-2 opacity-40" />
            <p>No hosts yet.</p>
            <p>
              Hosts appear when a daemon registers with a <code className="bg-muted px-1.5 py-0.5 rounded">host</code> block
              — run the backfill script to create hosts for existing daemons.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {hosts.map((host) => <HostCard key={host.id} host={host} />)}
        </div>
      )}
    </div>
  )
}
