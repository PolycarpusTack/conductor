'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const TTL_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '8', label: '8 hours' },
  { value: '12', label: '12 hours (default)' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
]

/**
 * Instance-wide security settings (Epic S2): change the admin password
 * (DB override; env var stays the break-glass credential) and session TTL.
 */
export function SettingsSecurity() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSource, setPasswordSource] = useState<'database' | 'environment' | null>(null)

  const [ttl, setTtl] = useState('12')
  const [savingTtl, setSavingTtl] = useState(false)

  useEffect(() => {
    fetch('/api/admin/security/config', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data) {
          setTtl(String(data.sessionTtlHours))
          setPasswordSource(data.passwordSource)
        }
      })
      .catch(() => {})
  }, [])

  const changePassword = async () => {
    setPasswordError(null)
    setPasswordStatus(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    setChanging(true)
    try {
      const res = await fetch('/api/admin/security/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setPasswordError(data?.error || 'Failed to change password')
        return
      }
      setPasswordStatus('Password changed. All sessions are invalidated — you will be asked to sign in again.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSource('database')
    } catch {
      setPasswordError('Failed to change password')
    } finally {
      setChanging(false)
    }
  }

  const saveTtl = async (value: string) => {
    setTtl(value)
    setSavingTtl(true)
    try {
      await fetch('/api/admin/security/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionTtlHours: parseInt(value, 10) }),
      })
    } finally {
      setSavingTtl(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        These settings apply to the whole Conductor instance, not just this project.
      </p>

      <div className="rounded-lg border border-border/30 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Admin Password</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {passwordSource === 'database'
              ? 'Managed here (overrides the env var). Break-glass: clear the AdminConfig row to fall back to AGENTBOARD_ADMIN_PASSWORD.'
              : 'Currently from the AGENTBOARD_ADMIN_PASSWORD env var. Setting one here overrides it.'}
          </p>
        </div>
        <div className="grid gap-2 max-w-sm">
          <label htmlFor="security-current-password" className="text-xs font-medium">Current password</label>
          <Input
            id="security-current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <label htmlFor="security-new-password" className="text-xs font-medium">New password (min 8 characters)</label>
          <Input
            id="security-new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <label htmlFor="security-confirm-password" className="text-xs font-medium">Confirm new password</label>
          <Input
            id="security-confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={changing || !currentPassword || newPassword.length < 8 || !confirmPassword}
            onClick={changePassword}
          >
            {changing ? 'Changing…' : 'Change password'}
          </Button>
          <span className="text-[11px] text-muted-foreground">Changing it signs everyone out, including you.</span>
        </div>
        {passwordStatus && <p className="text-xs text-emerald-400">{passwordStatus}</p>}
        {passwordError && <p className="text-xs text-[var(--op-red,#F87171)]">{passwordError}</p>}
      </div>

      <div className="rounded-lg border border-border/30 p-4 space-y-2">
        <div>
          <p className="text-sm font-medium">Session Length</p>
          <p className="text-xs text-muted-foreground mt-0.5">Applies to new sign-ins; existing sessions keep their original expiry.</p>
        </div>
        <Select value={ttl} onValueChange={saveTtl} disabled={savingTtl}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
