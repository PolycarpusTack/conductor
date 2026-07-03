'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LandingView } from './_views/LandingView'
import { viewToPath } from './_views/view-routes'

/**
 * E-1: '/' is the marketing landing page only. The app views are real routes
 * now — /board, /runtime, /skills (client, shared BoardShell layout) and
 * /help (server-rendered). "Launch Board" navigates to /board; the board's
 * auth gate lives in the (board) layout.
 */
export default function Home() {
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Warm the board route so "Launch Board" is instant.
  useEffect(() => {
    router.prefetch('/board')
  }, [router])

  // '?' opens the help route (parity with the shell's shortcut).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      router.push('/help')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  return (
    <LandingView
      setView={(v) => router.push(viewToPath(v))}
      sidebarOpen={sidebarOpen}
      setSidebarOpen={setSidebarOpen}
    />
  )
}
