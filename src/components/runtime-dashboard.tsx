'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, Server, Cpu, HardDrive, Activity, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import { DaemonLogViewer } from '@/components/daemon-log-viewer'
import type { LiveAgentLogEntry } from '@/types/live-agent'

interface DaemonInfo {
  id: string
  hostname: string
  platform: string
  version: string
  capabilities: Record<string, unknown>
  runtimes: string[]
  status: string
  lastSeenAt: string | null
  workspaceId: string
  tokenPreview: string
  createdAt: string
}

interface DaemonStatusResponse {
  daemons: DaemonInfo[]
  summary: { total: number; online: number; stale: number; offline: number }
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

interface RuntimeDashboardProps {
  liveAgentLogs: LiveAgentLogEntry[]
}

export function RuntimeDashboard({ liveAgentLogs }: RuntimeDashboardProps) {
  const [data, setData] = useState<DaemonStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedDaemon, setExpandedDaemon] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/daemon/status')
      if (res.ok) {
        setData(await res.json())
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 10_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading daemon status...
      </div>
    )
  }

  const { daemons, summary } = data

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{summary.total}</p>
                <p className="text-xs text-muted-foreground">Total Daemons</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Wifi className="w-4 h-4 text-green-500" />
              <div>
                <p className="text-2xl font-bold text-green-600">{summary.online}</p>
                <p className="text-xs text-muted-foreground">Online</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold text-yellow-600">{summary.stale}</p>
                <p className="text-xs text-muted-foreground">Stale</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-red-500" />
              <div>
                <p className="text-2xl font-bold text-red-600">{summary.offline}</p>
                <p className="text-xs text-muted-foreground">Offline</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Daemon list */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Connected Daemons</h3>
        <Button variant="ghost" size="sm" onClick={fetchStatus} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {daemons.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No daemons registered. Start one with <code className="bg-muted px-1.5 py-0.5 rounded">conductor daemon start</code>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {daemons.map((daemon) => {
            const style = STATUS_STYLES[daemon.status] || STATUS_STYLES.offline
            const isExpanded = expandedDaemon === daemon.id
            const lastSeen = daemon.lastSeenAt ? new Date(daemon.lastSeenAt) : null
            const ago = lastSeen ? Math.round((Date.now() - lastSeen.getTime()) / 1000) : null

            return (
              <Card key={daemon.id} className="overflow-hidden">
                <CardHeader
                  className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedDaemon(isExpanded ? null : daemon.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={`gap-1 ${style.className}`}>
                        {style.icon}
                        {daemon.status}
                      </Badge>
                      <div>
                        <CardTitle className="text-sm font-medium">{daemon.hostname}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {PLATFORM_LABELS[daemon.platform] || daemon.platform} · v{daemon.version}
                          {ago !== null && ` · ${ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {daemon.runtimes.map((r) => (
                        <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                      ))}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 pb-4 px-4 space-y-3">
                    <Separator />

                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">Daemon ID</p>
                        <p className="font-mono">{daemon.id.slice(0, 12)}...</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Token</p>
                        <p className="font-mono">{daemon.tokenPreview}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Registered</p>
                        <p>{new Date(daemon.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <DaemonLogViewer
                      taskId={daemon.id}
                      // Intentional: filters to this daemon's entries only. HTTP-source events
                      // have daemonId: undefined and are naturally excluded from daemon-scoped views.
                      entries={liveAgentLogs.filter(
                        (l): l is LiveAgentLogEntry & { daemonId: string } =>
                          l.daemonId === daemon.id,
                      )}
                      isRunning={daemon.status === 'online'}
                    />
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
