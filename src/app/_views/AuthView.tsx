'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Bot, Sparkles } from 'lucide-react'

interface AuthViewProps {
  authChecking: boolean
  adminPassword: string
  setAdminPassword: (v: string) => void
  adminEmail: string
  setAdminEmail: (v: string) => void
  usersExist: boolean
  adminConfigured: boolean
  authError: string | null
  loading: boolean
  handleAdminLogin: () => void
  setView: (v: 'landing' | 'board' | 'runtime' | 'skills' | 'help') => void
}

export function AuthView({
  authChecking,
  adminPassword,
  setAdminPassword,
  adminEmail,
  setAdminEmail,
  usersExist,
  adminConfigured,
  authError,
  loading,
  handleAdminLogin,
  setView,
}: AuthViewProps) {
  if (authChecking) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Sparkles className="h-8 w-8 animate-pulse text-muted-foreground/30" />
            <span className="text-sm text-muted-foreground">Checking admin session...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background dark">
      <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <div className="w-full rounded-2xl border border-border/30 bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground">
              <Bot className="h-5 w-5 text-background" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Admin Access</h1>
              <p className="text-sm text-muted-foreground">Sign in to manage projects, agents, and task workflow.</p>
            </div>
          </div>

          <div className="space-y-4">
            {usersExist && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdminLogin()
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Upgraded from the shared password? Your account is <code>owner@conductor.local</code> with the same password.
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <label className="text-sm font-medium">{usersExist ? 'Password' : 'Admin password'}</label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder={usersExist ? 'Enter your password' : 'Enter admin password'}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdminLogin()
                }}
              />
            </div>

            {!adminConfigured && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Set `AGENTBOARD_ADMIN_PASSWORD` on the server before using the board.
              </div>
            )}

            {authError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {authError}
              </div>
            )}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={handleAdminLogin} disabled={loading || !adminConfigured}>
                Sign In
              </Button>
              <Button variant="outline" onClick={() => setView('landing')}>
                Back
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
