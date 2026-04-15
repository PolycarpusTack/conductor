'use client'

import { useState, useEffect } from 'react'
import { BarChart3, AlertTriangle, Clock, DollarSign, Zap, TrendingUp } from 'lucide-react'

interface ProjectOverview {
  totalTasks: number
  completedTasks: number
  completionRate: number
  totalTokens: number
  totalCost: number
  avgDurationMs: number
  successRate: number
  totalExecutions: number
}

interface AgentScorecard {
  agentId: string
  agentName: string
  agentEmoji: string
  totalExecutions: number
  succeeded: number
  failed: number
  successRate: number
  totalTokens: number
  totalCost: number
  avgDurationMs: number
}

interface RuntimeStat {
  runtimeId: string
  runtimeName: string
  adapter: string
  totalExecutions: number
  succeeded: number
  failed: number
  errorRate: number
  avgLatencyMs: number
  totalTokens: number
  totalCost: number
}

interface FailureCluster {
  errorPattern: string
  count: number
  lastSeen: string
  status: string
}

interface Bottleneck {
  mode: string
  executionCount: number
  avgDurationMs: number
  maxDurationMs: number
}

interface ObservabilityDashboardProps {
  projectId: string
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`
  return `${(tokens / 1000000).toFixed(1)}M`
}

export function ObservabilityDashboard({ projectId }: ObservabilityDashboardProps) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null)
  const [agents, setAgents] = useState<AgentScorecard[]>([])
  const [runtimes, setRuntimes] = useState<RuntimeStat[]>([])
  const [failures, setFailures] = useState<FailureCluster[]>([])
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'overview' | 'agents' | 'runtimes' | 'failures' | 'bottlenecks'>('overview')

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const safeFetch = async (view: string) => {
          const r = await fetch(`/api/projects/${projectId}/analytics?view=${view}`)
          if (!r.ok) return null
          return r.json()
        }
        const [ov, ag, rt, fl, bn] = await Promise.allSettled([
          safeFetch('overview'),
          safeFetch('agents'),
          safeFetch('runtimes'),
          safeFetch('failures'),
          safeFetch('bottlenecks'),
        ])
        if (ov.status === 'fulfilled' && ov.value) setOverview(ov.value)
        if (ag.status === 'fulfilled' && ag.value) setAgents(ag.value)
        if (rt.status === 'fulfilled' && rt.value) setRuntimes(rt.value)
        if (fl.status === 'fulfilled' && fl.value) setFailures(fl.value)
        if (bn.status === 'fulfilled' && bn.value) setBottlenecks(bn.value)
      } catch (err) {
        console.error('Failed to fetch analytics:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [projectId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading analytics...
      </div>
    )
  }

  const sections = [
    { key: 'overview' as const, label: 'Overview', icon: BarChart3 },
    { key: 'agents' as const, label: 'Agents', icon: Zap },
    { key: 'runtimes' as const, label: 'Runtimes', icon: TrendingUp },
    { key: 'failures' as const, label: 'Failures', icon: AlertTriangle },
    { key: 'bottlenecks' as const, label: 'Bottlenecks', icon: Clock },
  ]

  return (
    <div className="space-y-4">
      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {sections.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeSection === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeSection === 'overview' && overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Tasks Completed" value={`${overview.completedTasks}/${overview.totalTasks}`} sub={`${Math.round(overview.completionRate * 100)}% rate`} />
          <MetricCard label="Total Cost" value={formatCost(overview.totalCost)} sub={`${formatTokens(overview.totalTokens)} tokens`} />
          <MetricCard label="Avg Duration" value={formatDuration(overview.avgDurationMs)} sub={`${overview.totalExecutions} executions`} />
          <MetricCard label="Success Rate" value={`${Math.round(overview.successRate * 100)}%`} sub={`of ${overview.totalExecutions} runs`} />
        </div>
      )}

      {/* Agent Scorecards */}
      {activeSection === 'agents' && (
        <div className="space-y-2">
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No agent execution data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">Agent</th>
                    <th className="text-right py-2 px-2">Runs</th>
                    <th className="text-right py-2 px-2">Success</th>
                    <th className="text-right py-2 px-2">Avg Time</th>
                    <th className="text-right py-2 px-2">Tokens</th>
                    <th className="text-right py-2 pl-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map(agent => (
                    <tr key={agent.agentId} className="border-b border-border/50">
                      <td className="py-2 pr-3">
                        <span className="mr-1">{agent.agentEmoji}</span>
                        {agent.agentName}
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums">{agent.totalExecutions}</td>
                      <td className="text-right py-2 px-2 tabular-nums">
                        <span className={agent.successRate >= 0.8 ? 'text-green-500' : agent.successRate >= 0.5 ? 'text-amber-500' : 'text-red-500'}>
                          {Math.round(agent.successRate * 100)}%
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums">{formatDuration(agent.avgDurationMs)}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{formatTokens(agent.totalTokens)}</td>
                      <td className="text-right py-2 pl-2 tabular-nums">{formatCost(agent.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Runtime Stats */}
      {activeSection === 'runtimes' && (
        <div className="space-y-2">
          {runtimes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No runtime execution data yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3">Runtime</th>
                    <th className="text-right py-2 px-2">Runs</th>
                    <th className="text-right py-2 px-2">Err Rate</th>
                    <th className="text-right py-2 px-2">Avg Latency</th>
                    <th className="text-right py-2 px-2">Tokens</th>
                    <th className="text-right py-2 pl-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runtimes.map(rt => (
                    <tr key={rt.runtimeId} className="border-b border-border/50">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{rt.runtimeName}</span>
                        <span className="text-muted-foreground ml-1">({rt.adapter})</span>
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums">{rt.totalExecutions}</td>
                      <td className="text-right py-2 px-2 tabular-nums">
                        <span className={rt.errorRate <= 0.1 ? 'text-green-500' : rt.errorRate <= 0.3 ? 'text-amber-500' : 'text-red-500'}>
                          {Math.round(rt.errorRate * 100)}%
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 tabular-nums">{formatDuration(rt.avgLatencyMs)}</td>
                      <td className="text-right py-2 px-2 tabular-nums">{formatTokens(rt.totalTokens)}</td>
                      <td className="text-right py-2 pl-2 tabular-nums">{formatCost(rt.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Failure Clusters */}
      {activeSection === 'failures' && (
        <div className="space-y-2">
          {failures.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No failures recorded</p>
          ) : (
            failures.map((f, i) => (
              <div key={i} className="p-3 rounded-lg border border-border/50 bg-muted/30">
                <div className="flex items-start justify-between gap-2">
                  <code className="text-xs text-red-400 break-all">{f.errorPattern}</code>
                  <span className="shrink-0 text-xs font-medium bg-red-500/10 text-red-500 px-2 py-0.5 rounded">
                    {f.count}x
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Last seen: {new Date(f.lastSeen).toLocaleString()} &middot; {f.status}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Chain Bottlenecks */}
      {activeSection === 'bottlenecks' && (
        <div className="space-y-2">
          {bottlenecks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No execution data yet</p>
          ) : (
            bottlenecks.map((b, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/30">
                <div>
                  <span className="text-sm font-medium">{b.mode}</span>
                  <span className="text-xs text-muted-foreground ml-2">{b.executionCount} runs</span>
                </div>
                <div className="text-right">
                  <div className="text-sm tabular-nums">{formatDuration(b.avgDurationMs)} avg</div>
                  <div className="text-xs text-muted-foreground tabular-nums">{formatDuration(b.maxDurationMs)} max</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="p-3 rounded-lg border border-border/50 bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  )
}
