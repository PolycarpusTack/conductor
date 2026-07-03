'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bot } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * D-5: top-level set-password page (NOT under the (board) auth gate). Reached
 * from a tokenized invite / reset email at `/set-password?token=…`. Posts to
 * /api/auth/reset/confirm, then routes to sign-in.
 */
export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  )
}

function SetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    if (submitting) return
    setError(null)

    if (!token) {
      setError('This link is missing its token. Request a new reset email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || 'This reset link is invalid or has expired.')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/board'), 1500)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
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
              <h1 className="text-lg font-semibold">Set your password</h1>
              <p className="text-sm text-muted-foreground">Choose a password to finish signing in.</p>
            </div>
          </div>

          {done ? (
            <div className="rounded-lg border border-border/30 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              Password set. Redirecting you to sign in…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Confirm password</label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                />
              </div>

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button className="flex-1" onClick={submit} disabled={submitting || !password || !confirm}>
                  Set password
                </Button>
                <Button variant="outline" onClick={() => router.push('/board')}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
