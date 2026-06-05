'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Check, Copy, Plus, ShieldOff } from 'lucide-react'

interface ScopedKey {
  id: string
  prefix: string
  label: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

/**
 * Integration (scoped) API keys — for CI, webhooks, dashboards.
 * Self-fetching against /api/admin/api-keys; the raw key is shown exactly
 * once after issuing.
 */
export function SettingsScopedKeys() {
  const [keys, setKeys] = useState<ScopedKey[]>([])
  const [label, setLabel] = useState('')
  const [scopeRead, setScopeRead] = useState(true)
  const [scopeWrite, setScopeWrite] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [freshKey, setFreshKey] = useState<{ id: string; rawKey: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/api-keys', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setKeys(data.keys)
      }
    } catch {
      // informational list — leave as-is on transient failure
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const issue = async () => {
    const scopes = [...(scopeRead ? ['read'] : []), ...(scopeWrite ? ['write'] : [])]
    if (!label.trim() || scopes.length === 0) return
    setIssuing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), scopes }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Failed to issue key')
        return
      }
      setFreshKey({ id: data.id, rawKey: data.rawKey })
      setLabel('')
      await fetchKeys()
    } catch {
      setError('Failed to issue key')
    } finally {
      setIssuing(false)
    }
  }

  const revoke = async (key: ScopedKey) => {
    if (!window.confirm(`Revoke "${key.label}" (${key.prefix}…)? Integrations using it will stop working immediately.`)) return
    try {
      const res = await fetch(`/api/admin/api-keys?id=${encodeURIComponent(key.id)}`, { method: 'DELETE' })
      if (res.ok) await fetchKeys()
    } catch {
      // list refresh will reflect reality either way
    }
  }

  const copyFresh = async () => {
    if (!freshKey) return
    await navigator.clipboard.writeText(freshKey.rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border border-border/30 p-4">
      <h4 className="text-sm font-medium mb-2">Integration Keys (scoped)</h4>
      <p className="text-xs text-muted-foreground mb-3">
        For CI pipelines, webhooks, and dashboards. <code>read</code> can pull activity, analytics, hosts, and
        sessions; <code>write</code> can create tasks. The full key is shown once — only a prefix and hash are stored.
      </p>

      {freshKey && (
        <div className="mb-3 rounded border border-emerald-500/30 bg-emerald-500/5 p-3">
          <p className="text-xs font-medium text-emerald-400 mb-1.5">New key — copy it now, it won&apos;t be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] font-mono bg-muted/30 px-2 py-1.5 rounded break-all">{freshKey.rawKey}</code>
            <Button variant="outline" size="sm" onClick={copyFresh}>
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {keys.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic">No integration keys issued yet.</p>
        )}
        {keys.map((key) => (
          <div key={key.id} className={`flex items-center gap-2 p-2 rounded bg-muted/20 ${key.revokedAt ? 'opacity-50' : ''}`}>
            <span className="text-xs font-medium min-w-0 truncate">{key.label}</span>
            <code className="text-[11px] font-mono text-muted-foreground">{key.prefix}…</code>
            {key.scopes.map((s) => (
              <Badge key={s} variant="secondary" className="text-[9px]">{s}</Badge>
            ))}
            {key.revokedAt && (
              <Badge variant="outline" className="text-[9px] text-[var(--op-red,#F87171)] border-[var(--op-red-dim,rgba(248,113,113,0.2))]">revoked</Badge>
            )}
            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
              {key.lastUsedAt ? `used ${new Date(key.lastUsedAt).toLocaleDateString()}` : 'never used'}
            </span>
            {!key.revokedAt && (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Revoke" onClick={() => revoke(key)}>
                <ShieldOff className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. github-actions)"
          className="h-8 text-xs flex-1"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={scopeRead} onCheckedChange={(v) => setScopeRead(v === true)} /> read
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={scopeWrite} onCheckedChange={(v) => setScopeWrite(v === true)} /> write
        </label>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={issue}
          disabled={issuing || !label.trim() || (!scopeRead && !scopeWrite)}
        >
          <Plus className="h-3 w-3 mr-1" />
          Issue
        </Button>
      </div>
      {error && <p className="text-[11px] text-[var(--op-red,#F87171)] mt-2">{error}</p>}
    </div>
  )
}
