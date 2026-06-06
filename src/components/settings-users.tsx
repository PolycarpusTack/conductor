'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Copy, Check, KeyRound, Plus } from 'lucide-react'

interface ManagedUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'admin' | 'member'
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

/**
 * User management (per-user accounts Phase 1). Admin-gated server-side;
 * members get a 403 and this section explains why instead of rendering.
 */
export function SettingsUsers() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [me, setMe] = useState<{ email: string; role: string } | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('member')

  // One-time temp password reveal (the API-key-rotation pattern)
  const [revealed, setRevealed] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' })
      if (res.status === 403) { setForbidden(true); return }
      if (res.ok) setUsers(await res.json())
    } catch {}
  }, [])

  useEffect(() => {
    void fetchUsers()
    fetch('/api/admin/session', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.user) setMe(data.user) })
      .catch(() => {})
  }, [fetchUsers])

  const createUser = async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create user')
      setUsers(prev => [...prev, data.user])
      setRevealed({ email: data.user.email, password: data.tempPassword })
      setCopied(false)
      setCreating(false)
      setNewEmail('')
      setNewName('')
      setNewRole('member')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    }
  }

  const updateUser = async (userId: string, patch: Record<string, unknown>) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update user')
      setUsers(prev => prev.map(u => u.id === userId ? data.user : u))
      if (data.tempPassword) {
        setRevealed({ email: data.user.email, password: data.tempPassword })
        setCopied(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  // "Your account" (Phase 3) — every role manages itself here
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwStatus, setPwStatus] = useState<string | null>(null)
  const [pwError, setPwError] = useState<string | null>(null)

  const changeMyPassword = async () => {
    setPwError(null)
    setPwStatus(null)
    try {
      const res = await fetch('/api/admin/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')
      setPwStatus('Password changed — other sessions for your account were signed out.')
      setCurrentPw('')
      setNewPw('')
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password')
    }
  }

  const signOutEverywhere = async () => {
    await fetch('/api/admin/me', { method: 'DELETE' })
    window.location.reload()
  }

  const yourAccount = me && me.email !== 'admin@legacy' ? (
    <div className="space-y-2 p-3 rounded-lg border border-border/30 bg-card/30">
      <h3 className="text-sm font-semibold">Your account</h3>
      <p className="text-xs text-muted-foreground">
        Signed in as <strong>{me.email}</strong> ({me.role}).
      </p>
      {pwError && <p className="text-xs text-destructive">{pwError}</p>}
      {pwStatus && <p className="text-xs text-[var(--op-green,#4ADE80)]">{pwStatus}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
          placeholder="Current password" autoComplete="current-password" className="h-8 text-xs" />
        <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
          placeholder="New password (min 8 chars)" autoComplete="new-password" className="h-8 text-xs" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={changeMyPassword} disabled={!currentPw || newPw.length < 8}>
          Change Password
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={signOutEverywhere}>
          Sign Out Everywhere
        </Button>
      </div>
    </div>
  ) : null

  if (forbidden) {
    return (
      <div className="space-y-4">
        {yourAccount}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Users</h3>
          <p className="text-xs text-muted-foreground">
            User management needs an admin or owner account — ask one of yours.
          </p>
        </div>
      </div>
    )
  }

  const isOwner = me?.role === 'owner'

  return (
    <div className="space-y-3">
      {yourAccount}
      <div>
        <h3 className="text-sm font-semibold">Users</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Named accounts replace the shared admin password.
        </p>
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {revealed && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="text-xs font-medium">
            Temporary password for <strong>{revealed.email}</strong> — shown once, share it securely:
          </p>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono flex-1 bg-background/60 rounded px-2 py-1">{revealed.password}</code>
            <Button variant="outline" size="sm" className="h-7"
              onClick={async () => { await navigator.clipboard.writeText(revealed.password); setCopied(true) }}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setRevealed(null)}>Done</Button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {users.map((user) => {
          const canManage = user.role !== 'owner' || isOwner
          return (
            <div key={user.id} className={`flex items-center gap-2 p-2 rounded-lg border border-border/30 bg-card/50 ${user.isActive ? '' : 'opacity-50'}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.name} <span className="text-xs text-muted-foreground font-normal">{user.email}</span></div>
                <div className="text-[10px] text-muted-foreground">
                  {user.lastLoginAt ? `last login ${new Date(user.lastLoginAt).toLocaleString()}` : 'never signed in'}
                  {!user.isActive && ' · deactivated'}
                </div>
              </div>
              <Select
                value={user.role}
                onValueChange={(role) => updateUser(user.id, { role })}
                disabled={!canManage}
              >
                <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member" className="text-xs">member</SelectItem>
                  <SelectItem value="admin" className="text-xs">admin</SelectItem>
                  {isOwner && <SelectItem value="owner" className="text-xs">owner</SelectItem>}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-7 text-xs" title="Reset password"
                disabled={!canManage}
                onClick={() => updateUser(user.id, { resetPassword: true })}>
                <KeyRound className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs"
                disabled={!canManage || me?.email === user.email}
                onClick={() => updateUser(user.id, { isActive: !user.isActive })}>
                {user.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          )
        })}
      </div>

      {creating ? (
        <div className="p-3 rounded-lg border border-border/30 bg-card/30 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" className="h-8 text-xs" />
            <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" className="h-8 text-xs" />
          </div>
          <Select value={newRole} onValueChange={setNewRole}>
            <SelectTrigger className="h-8 text-xs w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member" className="text-xs">member</SelectItem>
              <SelectItem value="admin" className="text-xs">admin</SelectItem>
              {isOwner && <SelectItem value="owner" className="text-xs">owner</SelectItem>}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            A temporary password is generated and shown once — the new user should change it after first login.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={createUser} disabled={!newEmail.trim() || !newName.trim()}>Create</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setCreating(true)}>
          <Plus className="h-3 w-3 mr-1" />
          Add User
        </Button>
      )}
    </div>
  )
}
