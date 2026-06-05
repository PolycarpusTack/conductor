'use client'

import { useState, useCallback } from 'react'

export function useAdminAuth() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(true)
  const [adminPassword, setAdminPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  const checkAdminSession = useCallback(async () => {
    setAuthChecking(true)
    try {
      const res = await fetch('/api/admin/session', { cache: 'no-store' })
      const data = await res.json()
      setAdminConfigured(Boolean(data.configured))
      setIsAdminAuthenticated(Boolean(data.authenticated))
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

  const login = useCallback(async (password: string): Promise<boolean> => {
    setAuthError(null)
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || 'Failed to sign in')
        return false
      }
      setIsAdminAuthenticated(true)
      setAdminPassword('')
      return true
    } catch {
      setAuthError('Failed to sign in')
      return false
    }
  }, [])

  // Clears auth state only. Caller is responsible for clearing project/board state.
  const logout = useCallback(async () => {
    await fetch('/api/admin/session', { method: 'DELETE' })
    setIsAdminAuthenticated(false)
    setAuthError(null)
  }, [])

  return {
    isAdminAuthenticated,
    adminConfigured,
    adminPassword,
    setAdminPassword,
    authError,
    authChecking,
    checkAdminSession,
    login,
    logout,
  }
}
