'use client'

import { useState, useCallback } from 'react'

export interface SessionUserInfo {
  name: string
  email: string
  role: string
}

export function useAdminAuth() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(true)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [usersExist, setUsersExist] = useState(false)
  const [sessionUser, setSessionUser] = useState<SessionUserInfo | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  const checkAdminSession = useCallback(async () => {
    setAuthChecking(true)
    try {
      const res = await fetch('/api/admin/session', { cache: 'no-store' })
      const data = await res.json()
      setAdminConfigured(Boolean(data.configured))
      setIsAdminAuthenticated(Boolean(data.authenticated))
      setUsersExist(Boolean(data.usersExist))
      setSessionUser(data.user ?? null)
      return Boolean(data.authenticated)
    } catch (error) {
      console.error('Error checking admin session:', error)
      setAdminConfigured(false)
      setIsAdminAuthenticated(false)
      return false
    } finally {
      setAuthChecking(false)
    }
  }, [])

  // Email is required once user accounts exist; the legacy password-only
  // path bootstraps the owner account on first login.
  const login = useCallback(async (password: string, email?: string): Promise<{ ok: boolean; bootstrapped?: string }> => {
    setAuthError(null)
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, ...(email?.trim() ? { email: email.trim() } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || 'Failed to sign in')
        return { ok: false }
      }
      setIsAdminAuthenticated(true)
      setSessionUser(data.user ?? null)
      if (data.usersExist !== undefined) setUsersExist(Boolean(data.usersExist))
      else if (data.user) setUsersExist(true)
      setAdminPassword('')
      setAdminEmail('')
      return { ok: true, bootstrapped: data.bootstrapped }
    } catch {
      setAuthError('Failed to sign in')
      return { ok: false }
    }
  }, [])

  // Clears auth state only. Caller is responsible for clearing project/board state.
  const logout = useCallback(async () => {
    await fetch('/api/admin/session', { method: 'DELETE' })
    setIsAdminAuthenticated(false)
    setSessionUser(null)
    setAuthError(null)
  }, [])

  return {
    isAdminAuthenticated,
    adminConfigured,
    adminPassword,
    setAdminPassword,
    adminEmail,
    setAdminEmail,
    usersExist,
    sessionUser,
    authError,
    authChecking,
    checkAdminSession,
    login,
    logout,
  }
}
