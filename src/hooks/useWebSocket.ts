'use client'

import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { ApiClientError } from '@/lib/api/client'
import { realtimeApi } from '@/lib/api/endpoints'
import type { RealtimeTokenResponse } from '@/types/api'
import type { Project, Activity } from '@/types/board'
import type { LiveAgentLogEntry } from '@/types/live-agent'

const realtimeSocketUrl = process.env.NEXT_PUBLIC_AGENTBOARD_WS_URL || '/?XTransformPort=3003'

interface UseWebSocketParams {
  currentProject: Project | null
  isAdminAuthenticated: boolean
  view: string
  fetchProject: (projectId: string) => Promise<Project | null>
  setCurrentProject: React.Dispatch<React.SetStateAction<Project | null>>
  setActivities: React.Dispatch<React.SetStateAction<Activity[]>>
  toast: (opts: { title: string; description?: string; variant?: 'destructive' | 'default' }) => void
}

export function useWebSocket({
  currentProject,
  isAdminAuthenticated,
  view,
  fetchProject,
  setCurrentProject,
  setActivities,
  toast,
}: UseWebSocketParams) {
  const socketRef = useRef<Socket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [realtimeConfigured, setRealtimeConfigured] = useState(true)
  const [liveAgentLogs, setLiveAgentLogs] = useState<LiveAgentLogEntry[]>([])
  // C-4: bumped on every 'notification-created' broadcast so the bell refetches
  const [notificationVersion, setNotificationVersion] = useState(0)

  useEffect(() => {
    if (view !== 'board' || !currentProject || !isAdminAuthenticated) return

    let isCancelled = false
    let activeSocket: Socket | null = null

    const connectRealtime = async () => {
      try {
        let data: RealtimeTokenResponse
        try {
          data = await realtimeApi.token(currentProject.id)
        } catch (error) {
          // API error (e.g. 503 when realtime is unconfigured) → not configured;
          // network errors fall through to the outer catch as before.
          if (error instanceof ApiClientError) {
            setRealtimeConfigured(false)
            setWsConnected(false)
            return
          }
          throw error
        }

        if (!data.token) {
          setRealtimeConfigured(Boolean(data.configured))
          setWsConnected(false)
          return
        }

        if (isCancelled) return

        setRealtimeConfigured(true)
        activeSocket = io(realtimeSocketUrl, {
          transports: ['websocket'],
          auth: { token: data.token },
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
          reconnectionDelayMax: 10000,
        })
        socketRef.current = activeSocket

        activeSocket.on('connect', () => setWsConnected(true))
        activeSocket.on('disconnect', () => setWsConnected(false))
        activeSocket.on('connect_error', (err) => {
          console.warn('[WS] Connection error:', err.message)
          setWsConnected(false)
        })
        activeSocket.io.on('reconnect_failed', () => {
          console.warn('[WS] Reconnection failed after max attempts — stopping')
          setWsConnected(false)
        })

        activeSocket.on('task-created', (task) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            tasks: prev.tasks.some(existing => existing.id === task.id)
              ? prev.tasks
              : [...prev.tasks, task],
          } : null)
        })

        activeSocket.on('task-updated', (task) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            tasks: prev.tasks.map(t => t.id === task.id ? task : t),
          } : null)
        })

        activeSocket.on('task-deleted', (taskId: string) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            tasks: prev.tasks.filter(t => t.id !== taskId),
          } : null)
        })

        activeSocket.on('task-moved', (data: { taskId: string; task: typeof currentProject.tasks[number] }) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            tasks: prev.tasks.map(t => t.id === data.taskId ? data.task : t),
          } : null)
        })

        activeSocket.on('agent-status', (data: { agentId: string; isActive: boolean }) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            agents: prev.agents.map(a => a.id === data.agentId ? { ...a, isActive: data.isActive } : a),
          } : null)
        })

        activeSocket.on('agent-activity', (data: Activity) => {
          setActivities(prev => [data, ...prev].slice(0, 50))
        })

        activeSocket.on('agent-live-event', (data: LiveAgentLogEntry) => {
          setLiveAgentLogs(prev => [...prev, data].slice(-500))
        })

        const refetchCurrentProject = () => {
          if (isCancelled) return
          fetchProject(currentProject.id).then(proj => {
            if (!isCancelled) setCurrentProject(proj)
          })
        }

        activeSocket.on('step-activated', refetchCurrentProject)
        activeSocket.on('step-completed', refetchCurrentProject)
        activeSocket.on('step-failed', refetchCurrentProject)
        activeSocket.on('chain-advanced', refetchCurrentProject)
        activeSocket.on('chain-completed', refetchCurrentProject)
        activeSocket.on('chain-rewound', refetchCurrentProject)

        activeSocket.on('notification-created', () => {
          if (!isCancelled) setNotificationVersion(v => v + 1)
        })

        activeSocket.on('reaction-failed', (data: { taskId: string; reactionName: string; error: string }) => {
          toast({
            title: `Reaction failed: ${data.reactionName}`,
            description: data.error,
            variant: 'destructive',
          })
        })
      } catch (error) {
        console.error('Error connecting realtime:', error)
        setWsConnected(false)
      }
    }

    connectRealtime()

    return () => {
      isCancelled = true
      activeSocket?.disconnect()
      if (socketRef.current === activeSocket) socketRef.current = null
    }
  }, [currentProject?.id, isAdminAuthenticated, view, fetchProject, setCurrentProject, setActivities, toast])

  return { wsConnected, realtimeConfigured, liveAgentLogs, notificationVersion, socketRef }
}
