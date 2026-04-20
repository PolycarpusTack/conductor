'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { WorkspaceSwitcher } from '@/components/workspace-switcher'
import { RuntimeDashboard } from '@/components/runtime-dashboard'
import { SkillsPage } from '@/components/skills-page'
import {
  Bot,
  Plus,
  ArrowRight,
  Menu,
  X,
  Settings,
  Trash2,
  GripVertical,
  UserPlus,
  Eye,
  Search,
  Pencil,
  Sparkles,
  Copy,
  Check,
  Key,
  Activity,
  BookOpen,
  HelpCircle,
  FolderPlus,
  RefreshCw,
  ExternalLink,
  LogOut,
  GitBranch,
  ChevronDown,
} from 'lucide-react'
import { io, Socket } from 'socket.io-client'
import { SettingsModes } from '@/components/settings-modes'
import { SettingsRuntimes } from '@/components/settings-runtimes'
import { SettingsMcp } from '@/components/settings-mcp'
import { SettingsTemplates } from '@/components/settings-templates'
import { ObservabilityDashboard } from '@/components/observability-dashboard'
import { SettingsAutomation } from '@/components/settings-automation'
import { AgentCreationModal } from '@/components/agent-creation-modal'
import { ChainBuilder } from '@/components/chain-builder'
import { StepOutputViewer } from '@/components/step-output-viewer'
import { TaskDetailDrawer } from '@/components/task-detail-drawer'
import { AgentActivityDashboard } from '@/components/agent-activity-dashboard'
import { HelpPage } from '@/components/help-page'
import { APP_VERSION_SHORT } from '@/lib/version'

// Types
type TaskStatus = 'BACKLOG' | 'IN_PROGRESS' | 'WAITING' | 'REVIEW' | 'DONE'
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

interface Agent {
  id: string
  name: string
  emoji: string
  color: string
  description?: string | null
  isActive: boolean
  lastSeen?: string | null
  role?: string | null
  capabilities?: string | null
  maxConcurrent: number
  supportedModes?: string | null
  modeInstructions?: string | null
  invocationMode?: string | null
  runtimeId?: string | null
  runtimeModel?: string | null
  systemPrompt?: string | null
  mcpConnectionIds?: string | null
}

interface TaskStepSummary {
  id: string
  order: number
  mode: string
  status: string
  agentId: string | null
  humanLabel: string | null
  autoContinue: boolean
  rejectionNote: string | null
  attempts: number
  agent: { id: string; name: string; emoji: string } | null
}

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  tag?: string
  notes?: string
  output?: string
  agent?: Agent | null
  order: number
  startedAt?: string | null
  completedAt?: string | null
  runtimeOverride?: string | null
  steps?: TaskStepSummary[]
}

interface Project {
  id: string
  name: string
  description?: string | null
  color: string
  agents: Agent[]
  tasks: Task[]
}

interface ProjectListItem {
  id: string
  name: string
  description?: string
  color: string
}

interface Activity {
  id: string
  action: string
  taskId?: string
  agentId?: string
  agent?: { name: string; emoji: string }
  details?: string
  createdAt: string
}

const statusColumns: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'BACKLOG', label: 'Backlog', color: 'text-3' },
  { id: 'IN_PROGRESS', label: 'In Progress', color: 'text-[var(--op-blue)]' },
  { id: 'WAITING', label: 'Waiting', color: 'text-[var(--op-amber)]' },
  { id: 'REVIEW', label: 'Review', color: 'text-[var(--op-purple)]' },
  { id: 'DONE', label: 'Done', color: 'text-[var(--op-teal)]' },
]

const priorityColors: Record<TaskPriority, string> = {
  LOW: 'bg-[var(--text-dim)]',
  MEDIUM: 'bg-[var(--op-amber)]',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-[var(--op-red)]',
}

const tagColors: Record<string, string> = {
  research: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
  docs: 'bg-[var(--op-blue-bg)] text-[var(--op-blue)] border border-[var(--op-blue-dim)]',
  backend: 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]',
  frontend: 'bg-pink-500/10 text-pink-400 border border-pink-500/20',
  devops: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  copy: 'bg-[var(--op-amber-bg)] text-[var(--op-amber)] border border-[var(--op-amber-dim)]',
  design: 'bg-[var(--op-purple-bg)] text-[var(--op-purple)] border border-[var(--op-purple-dim)]',
}

const realtimeSocketUrl = process.env.NEXT_PUBLIC_AGENTBOARD_WS_URL || '/?XTransformPort=3003'
const showDemoSeed = process.env.NODE_ENV !== 'production'

export default function Home() {
  const [view, setView] = useState<'landing' | 'board' | 'runtime' | 'skills' | 'help'>('landing')
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(false)
  const [seedingDemoData, setSeedingDemoData] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)
  const [chainDialogOpen, setChainDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [settingsTab, setSettingsTab] = useState<'general' | 'agents' | 'api' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | null>(null)
  const [expandedAgentStats, setExpandedAgentStats] = useState<string | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(true)
  const [adminPassword, setAdminPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [realtimeConfigured, setRealtimeConfigured] = useState(true)
  const [projectApiKey, setProjectApiKey] = useState<string | null>(null)
  const [projectApiPreview, setProjectApiPreview] = useState<string | null>(null)
  const [agentApiKeys, setAgentApiKeys] = useState<Record<string, string>>({})
  const [agentApiPreviews, setAgentApiPreviews] = useState<Record<string, string>>({})
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null)
  const [legacyKeyStatus, setLegacyKeyStatus] = useState<{ projectsWithPlaintext: number; agentsWithPlaintext: number; totalWithPlaintext: number } | null>(null)
  const [migratingLegacyKeys, setMigratingLegacyKeys] = useState(false)
  const [projectModes, setProjectModes] = useState<any[]>([])
  const [projectRuntimes, setProjectRuntimes] = useState<any[]>([])
  const [projectMcpConnections, setProjectMcpConnections] = useState<any[]>([])
  const [chainTemplates, setChainTemplates] = useState<any[]>([])
  const [taskSteps, setTaskSteps] = useState<any[]>([])
  const [viewingTaskSteps, setViewingTaskSteps] = useState<{ id: string; title: string; steps: TaskStepSummary[] } | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)

  // WebSocket
  const socketRef = useRef<Socket | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  
  // Form state for tasks
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskStatus, setTaskStatus] = useState<TaskStatus>('BACKLOG')
  const [mobileColumn, setMobileColumn] = useState<TaskStatus>('IN_PROGRESS')
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('MEDIUM')
  const [taskTag, setTaskTag] = useState('')
  const [taskAgentId, setTaskAgentId] = useState<string>('')
  const [taskNotes, setTaskNotes] = useState('')
  const [taskRuntimeOverride, setTaskRuntimeOverride] = useState<string>('')
  const [daemonLogs, setDaemonLogs] = useState<Array<{ taskId: string; stepId?: string; daemonId: string; event: { type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'; [key: string]: unknown }; timestamp: string }>>([])
  
  // Form state for projects
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectColor, setProjectColor] = useState('#3b82f6')
  const [createStarterAgents, setCreateStarterAgents] = useState(true)
  
  // Form state for agents
  const [agentName, setAgentName] = useState('')
  const [agentEmoji, setAgentEmoji] = useState('🤖')
  const [agentColor, setAgentColor] = useState('#3b82f6')
  const [agentDescription, setAgentDescription] = useState('')

  // Initialize WebSocket
  useEffect(() => {
    if (view !== 'board' || !currentProject || !isAdminAuthenticated) {
      return
    }

    let isCancelled = false
    let activeSocket: Socket | null = null

    const connectRealtime = async () => {
      try {
        const res = await fetch(`/api/realtime/token?projectId=${currentProject.id}`, { cache: 'no-store' })
        if (!res.ok) {
          setRealtimeConfigured(false)
          setWsConnected(false)
          return
        }

        const data = await res.json()
        if (!data.token) {
          setRealtimeConfigured(Boolean(data.configured))
          setWsConnected(false)
          return
        }

        if (isCancelled) {
          return
        }

        setRealtimeConfigured(true)
        activeSocket = io(realtimeSocketUrl, {
          transports: ['websocket'],
          auth: { token: data.token },
          reconnectionAttempts: 5,
          reconnectionDelay: 2000,
          reconnectionDelayMax: 10000,
        })
        socketRef.current = activeSocket

        activeSocket.on('connect', () => {
          console.log('[WS] Connected')
          setWsConnected(true)
        })

        activeSocket.on('disconnect', () => {
          console.log('[WS] Disconnected')
          setWsConnected(false)
        })

        activeSocket.on('connect_error', (err) => {
          console.warn('[WS] Connection error:', err.message)
          setWsConnected(false)
        })

        activeSocket.io.on('reconnect_failed', () => {
          console.warn('[WS] Reconnection failed after max attempts — stopping')
          setWsConnected(false)
        })

        activeSocket.on('task-created', (task: Task) => {
          setCurrentProject(prev => prev ? {
            ...prev,
            tasks: prev.tasks.some((existing) => existing.id === task.id)
              ? prev.tasks
              : [...prev.tasks, task],
          } : null)
        })

        activeSocket.on('task-updated', (task: Task) => {
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

        activeSocket.on('task-moved', (data: { taskId: string; task: Task }) => {
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

        const refetchCurrentProject = () => {
          if (isCancelled) return
          // Use the project ID from the effect closure (stable for this socket's lifetime)
          fetchProject(currentProject.id).then(proj => {
            if (!isCancelled) setCurrentProject(proj)
          })
        }

        activeSocket.on('daemon-agent-event', (data: unknown) => {
          const entry = data as typeof daemonLogs[number]
          setDaemonLogs(prev => [...prev, entry].slice(-500))
        })

        activeSocket.on('step-activated', refetchCurrentProject)
        activeSocket.on('step-completed', refetchCurrentProject)
        activeSocket.on('step-failed', refetchCurrentProject)
        activeSocket.on('chain-advanced', refetchCurrentProject)
        activeSocket.on('chain-completed', refetchCurrentProject)
        activeSocket.on('chain-rewound', refetchCurrentProject)
      } catch (error) {
        console.error('Error connecting realtime:', error)
        setWsConnected(false)
      }
    }

    connectRealtime()

    return () => {
      isCancelled = true
      activeSocket?.disconnect()
      if (socketRef.current === activeSocket) {
        socketRef.current = null
      }
    }
  }, [currentProject?.id, isAdminAuthenticated, view])

  // Fetch all projects
  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) {
        return []
      }

      const data: ProjectListItem[] = await res.json()
      setProjects(data)
      return data
    } catch (error) {
      console.error('Error fetching projects:', error)
      return []
    }
  }, [])

  // Fetch single project with full data
  const fetchProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) {
        return null
      }
      const project = await res.json()
      return project
    } catch (error) {
      console.error('Error fetching project:', error)
      return null
    }
  }

  const readApiError = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = await response.json()
      return payload?.error || fallback
    } catch {
      return fallback
    }
  }, [])

  const loadApiKeys = useCallback(async (project: Project) => {
    setLoadingApiKeys(true)
    setCopiedKey(null)

    try {
      const projectRes = await fetch(`/api/projects/${project.id}/key`, { cache: 'no-store' })
      if (!projectRes.ok) {
        throw new Error(await readApiError(projectRes, 'Failed to load project API key'))
      }

      const projectPayload = await projectRes.json()
      setProjectApiKey(null)
      setProjectApiPreview(projectPayload.preview || null)

      const keyEntries = await Promise.all(
        project.agents.map(async (agent) => {
          const res = await fetch(`/api/agents/${agent.id}/key`, { cache: 'no-store' })
          if (!res.ok) {
            throw new Error(await readApiError(res, `Failed to load API key for ${agent.name}`))
          }

          const payload = await res.json()
          return [agent.id, payload.preview || ''] as const
        }),
      )

      setAgentApiKeys({})
      setAgentApiPreviews(Object.fromEntries(keyEntries))
    } catch (error) {
      console.error('Error loading API keys:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to load API keys')
    } finally {
      setLoadingApiKeys(false)
    }
  }, [readApiError])

  const fetchLegacyKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/security/keys', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to load API key security status'))
      }

      setLegacyKeyStatus(await res.json())
    } catch (error) {
      console.error('Error loading API key security status:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to load API key security status')
    }
  }, [readApiError])

  const rotateProjectApiKey = async () => {
    if (!currentProject) {
      return
    }

    setRotatingKeyId('project')
    setAuthError(null)

    try {
      const res = await fetch(`/api/projects/${currentProject.id}/key`, { method: 'POST' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to rotate project API key'))
      }

      const payload = await res.json()
      setProjectApiKey(payload.apiKey || null)
      setProjectApiPreview(payload.preview || null)
      setCopiedKey((current) => (current === 'project' ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      console.error('Error rotating project API key:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to rotate project API key')
    } finally {
      setRotatingKeyId(null)
    }
  }

  const rotateAgentApiKey = async (agentId: string) => {
    setRotatingKeyId(agentId)
    setAuthError(null)

    try {
      const res = await fetch(`/api/agents/${agentId}/key`, { method: 'POST' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to rotate agent API key'))
      }

      const payload = await res.json()
      setAgentApiKeys((prev) => ({
        ...prev,
        [agentId]: payload.apiKey || '',
      }))
      setAgentApiPreviews((prev) => ({
        ...prev,
        [agentId]: payload.preview || prev[agentId] || '',
      }))
      setCopiedKey((current) => (current === agentId ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      console.error('Error rotating agent API key:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to rotate agent API key')
    } finally {
      setRotatingKeyId(null)
    }
  }

  const migrateLegacyKeys = async () => {
    if (!currentProject) {
      return
    }

    setMigratingLegacyKeys(true)
    setAuthError(null)

    try {
      const res = await fetch('/api/admin/security/keys', { method: 'POST' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to migrate legacy API keys'))
      }

      await Promise.all([loadApiKeys(currentProject), fetchLegacyKeyStatus()])
    } catch (error) {
      console.error('Error migrating legacy API keys:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to migrate legacy API keys')
    } finally {
      setMigratingLegacyKeys(false)
    }
  }

  const fetchActivities = useCallback(async (projectId: string) => {
    const actRes = await fetch(`/api/activity?projectId=${projectId}&limit=20`)
    if (!actRes.ok) {
      setActivities([])
      return
    }

    const actData = await actRes.json()
    setActivities(actData)
  }, [])

  const fetchProjectSettings = async (projectId: string) => {
    try {
      const [modesRes, runtimesRes, mcpRes, templatesRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/modes`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/runtimes`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/mcp-connections`, { cache: 'no-store' }),
        fetch(`/api/projects/${projectId}/chain-templates`, { cache: 'no-store' }),
      ])
      if (modesRes.ok) setProjectModes(await modesRes.json())
      if (runtimesRes.ok) setProjectRuntimes(await runtimesRes.json())
      if (mcpRes.ok) setProjectMcpConnections(await mcpRes.json())
      if (templatesRes.ok) setChainTemplates(await templatesRes.json())
    } catch (error) {
      console.error('Error fetching project settings:', error)
    }
  }

  const initializeBoard = useCallback(async () => {
    setLoading(true)

    try {
      const projectList = await fetchProjects()

      if (projectList.length > 0) {
        const fullProject = await fetchProject(projectList[0].id)
        setCurrentProject(fullProject)

        if (fullProject) {
          await fetchActivities(fullProject.id)
          await fetchProjectSettings(fullProject.id)
        }
      } else {
        setCurrentProject(null)
        setActivities([])
      }
    } catch (error) {
      console.error('Init error:', error)
    } finally {
      setLoading(false)
    }
  }, [fetchActivities, fetchProjects])

  const handleSeedDemoData = async () => {
    setSeedingDemoData(true)
    setAuthError(null)

    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to load demo data'))
      }

      await initializeBoard()
    } catch (error) {
      console.error('Error loading demo data:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to load demo data')
    } finally {
      setSeedingDemoData(false)
    }
  }

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

  // Initial data load
  useEffect(() => {
    if (view === 'board') {
      const init = async () => {
        const authenticated = await checkAdminSession()
        if (authenticated) {
          await initializeBoard()
        }
      }
      init()
    }
  }, [checkAdminSession, initializeBoard, view])

  useEffect(() => {
    setProjectApiKey(null)
    setProjectApiPreview(null)
    setAgentApiKeys({})
    setAgentApiPreviews({})
    setLegacyKeyStatus(null)
  }, [currentProject?.id])

  useEffect(() => {
    if (settingsTab === 'api' && currentProject) {
      loadApiKeys(currentProject)
      fetchLegacyKeyStatus()
    }
  }, [currentProject, fetchLegacyKeyStatus, loadApiKeys, settingsTab])

  // `?` opens the help page from anywhere. Ignored inside text inputs so users
  // can type `?` freely. Closes help if already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setView((v) => (v === 'help' ? 'board' : 'help'))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleAdminLogin = async () => {
    setAuthError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      })

      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || 'Failed to sign in')
        return
      }

      setIsAdminAuthenticated(true)
      setAdminPassword('')
      await initializeBoard()
    } catch (error) {
      console.error('Error signing in:', error)
      setAuthError('Failed to sign in')
    } finally {
      setLoading(false)
    }
  }

  const handleAdminLogout = async () => {
    await fetch('/api/admin/session', { method: 'DELETE' })
    setIsAdminAuthenticated(false)
    setCurrentProject(null)
    setProjects([])
    setActivities([])
    setSettingsTab(null)
    setAuthError(null)
  }

  // Switch project
  const switchProject = async (projectId: string) => {
    const project = await fetchProject(projectId)
    if (!project) {
      return
    }

    setCurrentProject(project)
    
    // Fetch activities for new project
    await fetchActivities(project.id)
    await fetchProjectSettings(project.id)
  }

  // Create project
  const handleCreateProject = async () => {
    if (!projectName.trim()) return
    setAuthError(null)
    
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          description: projectDescription,
          color: projectColor,
        }),
      })

      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to create project'))
      }
      
      const newProject: ProjectListItem = await res.json()
      setProjects(prev => [newProject, ...prev])
      
      // Reset form
      resetProjectForm()
      setProjectDialogOpen(false)
      
      if (createStarterAgents) {
        await createDefaultAgents(newProject.id)
      } else {
        const fullProject = await fetchProject(newProject.id)
        setCurrentProject(fullProject)
        if (fullProject) {
          await fetchActivities(fullProject.id)
          await fetchProjectSettings(fullProject.id)
        }
      }
    } catch (error) {
      console.error('Error creating project:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to create project')
    }
  }

  // Create default agents for a new project
  const createDefaultAgents = async (projectId: string) => {
    // Agents are seeded server-side during project creation — just fetch the project
    const updated = await fetchProject(projectId)
    setCurrentProject(updated)
    if (updated) {
      await fetchActivities(updated.id)
      await fetchProjectSettings(updated.id)
    }
  }

  // Create/Update task
  const handleSaveTask = async () => {
    if (!taskTitle.trim() || !currentProject) return
    setAuthError(null)
    
    try {
      if (editingTask) {
        // Update existing task
        const res = await fetch(`/api/tasks/${editingTask.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription,
            status: taskStatus,
            priority: taskPriority,
            tag: taskTag || undefined,
            agentId: taskAgentId || null,
            notes: taskNotes || undefined,
            runtimeOverride: taskRuntimeOverride && taskRuntimeOverride !== 'none' ? taskRuntimeOverride : null,
          }),
        })

        if (!res.ok) {
          throw new Error(await readApiError(res, 'Failed to update task'))
        }
        
        const updatedTask = await res.json()
        
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
        } : null)
        
      } else {
        // Create new task
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: taskDescription,
            status: taskStatus,
            priority: taskPriority,
            tag: taskTag || undefined,
            agentId: taskAgentId || undefined,
            notes: taskNotes || undefined,
            runtimeOverride: taskRuntimeOverride || undefined,
            projectId: currentProject.id,
            steps: taskSteps.length > 0 ? taskSteps : undefined,
          }),
        })

        if (!res.ok) {
          throw new Error(await readApiError(res, 'Failed to create task'))
        }
        
        const newTask = await res.json()
        
        setCurrentProject(prev => prev ? {
          ...prev,
          tasks: [...prev.tasks, newTask],
        } : null)
        
      }
      
      resetTaskForm()
      setTaskDialogOpen(false)
    } catch (error) {
      console.error('Error saving task:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to save task')
    }
  }

  const handleCreateChain = async () => {
    if (!currentProject || !taskTitle.trim() || taskSteps.length === 0) return

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription || undefined,
          status: 'BACKLOG',
          priority: taskPriority,
          projectId: currentProject.id,
          steps: taskSteps,
        }),
      })

      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to create chain'))
      }

      const newTask = await res.json()

      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: [...prev.tasks, newTask],
      } : null)

      resetTaskForm()
      setChainDialogOpen(false)
    } catch (error) {
      console.error('Error creating chain:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to create chain')
    }
  }

  // Delete task
  const handleDeleteTask = async (taskId: string) => {
    setAuthError(null)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to delete task'))
      }
      
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.filter(t => t.id !== taskId),
      } : null)
      
    } catch (error) {
      console.error('Error deleting task:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to delete task')
    }
  }

  // Create/Update agent
  const handleSaveAgent = async () => {
    if (!agentName.trim() || !currentProject) return
    setAuthError(null)
    
    try {
      if (editingAgent) {
        const res = await fetch(`/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: agentName,
            emoji: agentEmoji,
            color: agentColor,
            description: agentDescription,
          }),
        })

        if (!res.ok) {
          throw new Error(await readApiError(res, 'Failed to update agent'))
        }
        
        const updatedAgent = await res.json()
        
        setCurrentProject(prev => prev ? {
          ...prev,
          agents: prev.agents.map(a => a.id === updatedAgent.id ? updatedAgent : a),
        } : null)
      } else {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: agentName,
            emoji: agentEmoji,
            color: agentColor,
            description: agentDescription,
            projectId: currentProject.id,
          }),
        })

        if (!res.ok) {
          throw new Error(await readApiError(res, 'Failed to create agent'))
        }
        
        const newAgent = await res.json()
        
        setCurrentProject(prev => prev ? {
          ...prev,
          agents: [...prev.agents, newAgent],
        } : null)
      }
      
      resetAgentForm()
      setAgentDialogOpen(false)
    } catch (error) {
      console.error('Error saving agent:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to save agent')
    }
  }

  // Delete agent
  const handleDeleteAgent = async (agentId: string) => {
    setAuthError(null)
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to delete agent'))
      }
      
      setCurrentProject(prev => prev ? {
        ...prev,
        agents: prev.agents.filter(a => a.id !== agentId),
      } : null)
    } catch (error) {
      console.error('Error deleting agent:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to delete agent')
    }
  }

  // Drag and drop handlers
  const handleDragStart = (task: Task) => {
    setDraggedTask(task)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (status: TaskStatus) => {
    if (!draggedTask || draggedTask.status === status) {
      setDraggedTask(null)
      return
    }
    setAuthError(null)
    
    try {
      const res = await fetch(`/api/tasks/${draggedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!res.ok) {
        throw new Error(await readApiError(res, 'Failed to update task status'))
      }
      
      const updatedTask = await res.json()
      
      setCurrentProject(prev => prev ? {
        ...prev,
        tasks: prev.tasks.map(t => t.id === updatedTask.id ? updatedTask : t),
      } : null)
      
    } catch (error) {
      console.error('Error updating task status:', error)
      setAuthError(error instanceof Error ? error.message : 'Failed to update task status')
    } finally {
      setDraggedTask(null)
    }
  }

  // Form helpers
  const openEditTaskDialog = (task: Task) => {
    setEditingTask(task)
    setTaskTitle(task.title)
    setTaskDescription(task.description || '')
    setTaskStatus(task.status)
    setTaskPriority(task.priority)
    setTaskTag(task.tag || '')
    setTaskAgentId(task.agent?.id || '')
    setTaskNotes(task.notes || '')
    setTaskRuntimeOverride(task.runtimeOverride || '')
    setTaskDialogOpen(true)
  }

  const openNewTaskDialog = (status: TaskStatus = 'BACKLOG') => {
    resetTaskForm()
    setTaskStatus(status)
    setTaskDialogOpen(true)
  }

  const openNewChainDialog = () => {
    resetTaskForm()
    setTaskStatus('BACKLOG')
    setChainDialogOpen(true)
  }

  const resetTaskForm = () => {
    setTaskTitle('')
    setTaskDescription('')
    setTaskStatus('BACKLOG')
    setTaskPriority('MEDIUM')
    setTaskTag('')
    setTaskAgentId('')
    setTaskNotes('')
    setTaskRuntimeOverride('')
    setTaskSteps([])
    setEditingTask(null)
  }

  const resetProjectForm = () => {
    setProjectName('')
    setProjectDescription('')
    setProjectColor('#3b82f6')
    setCreateStarterAgents(true)
  }

  const openEditAgentDialog = async (agent: Agent) => {
    // Board-level agent objects come from taskBoardInclude's summary select
    // (missing maxConcurrent, invocationMode, capabilities, supportedModes,
    // modeInstructions, runtimeModel, systemPrompt, mcpConnectionIds).
    // Fetch the full record so the edit form doesn't populate defaults for
    // unseen fields and silently overwrite them on save.
    setAgentName(agent.name)
    setAgentEmoji(agent.emoji)
    setAgentColor(agent.color)
    setAgentDescription(agent.description || '')
    setAgentDialogOpen(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { cache: 'no-store' })
      if (res.ok) {
        setEditingAgent(await res.json())
      } else {
        setEditingAgent(agent) // fall back to summary shape rather than block editing
      }
    } catch {
      setEditingAgent(agent)
    }
  }

  const resetAgentForm = () => {
    setAgentName('')
    setAgentEmoji('🤖')
    setAgentColor('#3b82f6')
    setAgentDescription('')
    setEditingAgent(null)
  }

  // Copy to clipboard
  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Get tasks by status
  const getTasksByStatus = (status: TaskStatus) => {
    return currentProject?.tasks.filter(t => t.status === status).sort((a, b) => a.order - b.order) || []
  }

  // Format time ago
  const timeAgo = (date: string) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  // ===================== LANDING PAGE =====================
  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-background dark">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-transparent">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
            <a className="flex items-center gap-2" href="#">
              <img src="/icon.png" alt="Conductor" className="h-6 w-6 rounded-md" />
              <span className="text-sm font-semibold tracking-tight font-heading">Conductor</span>
            </a>
            <nav className="hidden items-center gap-8 md:flex">
              <a href="#features" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
                Features
              </a>
              <a href="#api" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
                API
              </a>
              <a href="#how-it-works" className="text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground">
                How it works
              </a>
            </nav>
            <div className="hidden items-center gap-4 md:flex">
              <Button
                variant="ghost"
                className="text-[13px] text-muted-foreground/60 hover:text-foreground"
                onClick={() => setView('board')}
              >
                Sign in
              </Button>
              <Button
                className="rounded-lg gradient-cobalt px-3.5 py-1.5 text-[13px] font-medium text-white hover:shadow-glow-cobalt transition-shadow"
                onClick={() => setView('board')}
              >
                Get Started
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {/* Mobile menu */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm md:hidden pt-14">
            <nav className="flex flex-col items-center gap-6 p-8">
              <a href="#features" className="text-lg text-muted-foreground" onClick={() => setSidebarOpen(false)}>
                Features
              </a>
              <a href="#api" className="text-lg text-muted-foreground" onClick={() => setSidebarOpen(false)}>
                API
              </a>
              <Button
                className="w-full rounded-lg gradient-cobalt text-white"
                onClick={() => { setSidebarOpen(false); setView('board') }}
              >
                Get Started
              </Button>
            </nav>
          </div>
        )}

        <main>
          {/* Hero Section */}
          <section className="relative overflow-hidden pt-28 pb-16 md:pt-36 md:pb-24">
            <div className="pointer-events-none absolute inset-0 opacity-[0.015]" style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`
            }} />
            <div className="pointer-events-none absolute right-0 top-16 h-[500px] w-[500px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />
            <div className="pointer-events-none absolute left-1/4 top-48 h-[300px] w-[300px] rounded-full bg-[var(--neon-green)]/[0.03] blur-[80px]" />

            <div className="relative mx-auto max-w-6xl px-6">
              <div className="text-center max-w-3xl mx-auto">
                <h1 className="text-4xl font-bold tracking-tight font-heading sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
                  Orchestrate AI agents.
                  <br />
                  <span className="text-[var(--text-2)]">Automate workflows.</span>
                </h1>
                <p className="mt-6 max-w-2xl mx-auto text-base leading-relaxed text-muted-foreground sm:text-[17px]">
                  Create agents, define workflow chains, and let Conductor dispatch work across AI providers — with human verification gates built in.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                  <Button
                    className="group inline-flex items-center gap-2 rounded-lg gradient-cobalt px-5 py-2.5 text-sm font-semibold text-white hover:shadow-glow-cobalt transition-shadow"
                    onClick={() => setView('board')}
                  >
                    Launch Board
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                  <a
                    href="#how-it-works"
                    className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    See how it works
                    <span className="text-[10px]">↓</span>
                  </a>
                </div>
              </div>
            </div>
          </section>

          {/* How It Works */}
          <section id="how-it-works" className="relative py-24 md:py-32">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="mx-auto max-w-6xl px-6">
              <div className="text-center mb-16">
                <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">How it works</h2>
                <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                  From agent creation to shipped output in four steps.
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-4">
                {[
                  {
                    step: "1",
                    title: "Create Agents",
                    description: "Define agents with roles, system prompts, and AI provider connections",
                    color: "var(--cobalt)",
                    bgClass: "bg-[var(--cobalt)]/10",
                    textClass: "text-[var(--cobalt)]",
                    icon: <Bot className="h-5 w-5" />,
                  },
                  {
                    step: "2",
                    title: "Build Workflows",
                    description: "Chain steps together: analyze, verify, develop, human review",
                    color: "var(--neon-green)",
                    bgClass: "bg-[var(--neon-green)]/10",
                    textClass: "text-[var(--neon-green)]",
                    icon: <GitBranch className="h-5 w-5" />,
                  },
                  {
                    step: "3",
                    title: "Dispatch & Execute",
                    description: "Conductor sends work to the right AI model automatically",
                    color: "var(--op-teal)",
                    bgClass: "bg-[var(--op-teal)]/10",
                    textClass: "text-[var(--op-teal)]",
                    icon: <Sparkles className="h-5 w-5" />,
                  },
                  {
                    step: "4",
                    title: "Review & Ship",
                    description: "Human gates pause the chain. Approve, then auto-continue",
                    color: "var(--op-amber)",
                    bgClass: "bg-[var(--op-amber)]/10",
                    textClass: "text-[var(--op-amber)]",
                    icon: <Eye className="h-5 w-5" />,
                  },
                ].map((item, i) => (
                  <div key={item.step} className="relative flex flex-col items-center text-center">
                    {i < 3 && (
                      <div className="pointer-events-none absolute right-0 top-10 hidden translate-x-1/2 md:block">
                        <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                    )}
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${item.bgClass} ${item.textClass}`}>
                      {item.icon}
                    </div>
                    <span className={`mb-1 text-xs font-semibold uppercase tracking-wider ${item.textClass}`}>
                      Step {item.step}
                    </span>
                    <h3 className="text-lg font-semibold font-heading mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Features Grid */}
          <section id="features" className="relative py-24 md:py-32">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            <div className="pointer-events-none absolute left-0 bottom-24 h-[400px] w-[400px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />

            <div className="mx-auto max-w-6xl px-6">
              <p className="mb-16 text-xs uppercase tracking-[0.2em] text-muted-foreground/40">Platform capabilities</p>

              <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--cobalt)]/10">
                    <GitBranch className="h-6 w-6 text-[var(--cobalt)]" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Workflow Chains</h3>
                  <p className="text-sm text-muted-foreground">
                    Multi-step agent workflows with automatic handoffs. Support investigation, bug fix, documentation — all as templates.
                  </p>
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-violet-500/10">
                    <Settings className="h-6 w-6 text-violet-400" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Multi-Runtime</h3>
                  <p className="text-sm text-muted-foreground">
                    Claude for coding, GPT for analysis, webhooks for custom systems. Each agent picks its own provider and model.
                  </p>
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--op-amber)]/10">
                    <Eye className="h-6 w-6 text-[var(--op-amber)]" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Human Gates</h3>
                  <p className="text-sm text-muted-foreground">
                    Insert human verification at any point. Tasks pause in WAITING until approved.
                  </p>
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--neon-green)]/10">
                    <Sparkles className="h-6 w-6 text-[var(--neon-green)]" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Agent Modes</h3>
                  <p className="text-sm text-muted-foreground">
                    Analyze, verify, develop, review, draft — agents behave differently per mode with scoped permissions.
                  </p>
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--op-teal)]/10">
                    <Copy className="h-6 w-6 text-[var(--op-teal)]" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Chain Templates</h3>
                  <p className="text-sm text-muted-foreground">
                    Pre-built workflow patterns. Pick a template, assign agents, go.
                  </p>
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Activity className="h-6 w-6 text-emerald-400" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Real-time Board</h3>
                  <p className="text-sm text-muted-foreground">
                    5-column Kanban with live updates. See chain progress on every task card.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* API Section */}
          <section id="api" className="relative py-24 md:py-32">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="mx-auto max-w-6xl px-6">
              <div className="text-center mb-16">
                <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">Agent HTTP API</h2>
                <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                  Connect your AI agents via simple HTTP endpoints. The dispatch system handles routing to the right provider automatically.
                </p>
              </div>

              <div className="grid gap-8 md:grid-cols-3">
                {/* CLI API */}
                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Key className="h-5 w-5 text-[var(--cobalt)]" /> CLI-Style API
                  </h3>
                  <div className="space-y-4">
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Get next task</div>
                      <div>GET /api/cli</div>
                      <div className="text-blue-400">Authorization: Bearer YOUR_KEY</div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Claim and start task</div>
                      <div>POST /api/cli</div>
                      <div className="text-blue-400">Authorization: Bearer YOUR_KEY</div>
                      <div className="text-foreground/70">{"{"} &quot;action&quot;: &quot;claim&quot;, &quot;task_id&quot;: &quot;...&quot; {"}"}</div>
                    </div>
                  </div>
                </div>

                {/* REST API */}
                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Activity className="h-5 w-5 text-emerald-400" /> REST API
                  </h3>
                  <div className="space-y-4">
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Get agent&apos;s tasks</div>
                      <div>GET /api/agent/tasks</div>
                      <div className="text-blue-400">Authorization: Bearer AGENT_KEY</div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Update task with action</div>
                      <div>PUT /api/agent/tasks/:id</div>
                      <div className="text-foreground/70">{"{"} &quot;action&quot;: &quot;complete&quot;, &quot;output&quot;: &quot;...&quot; {"}"}</div>
                    </div>
                  </div>
                </div>

                {/* Chain Dispatch API */}
                <div className="rounded-xl border border-border/30 bg-card p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-[var(--op-teal)]" /> Chain Dispatch
                  </h3>
                  <div className="space-y-4">
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Advance chain step</div>
                      <div>POST /api/chain/:id/advance</div>
                      <div className="text-blue-400">Authorization: Bearer ADMIN_KEY</div>
                    </div>
                    <div className="rounded-lg bg-muted/30 p-3 font-mono text-xs">
                      <div className="text-muted-foreground"># Approve human gate</div>
                      <div>POST /api/chain/:id/approve</div>
                      <div className="text-foreground/70">{"{"} &quot;step&quot;: 3, &quot;approved&quot;: true {"}"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="relative py-24 md:py-32">
            <div className="pointer-events-none absolute right-1/4 top-12 h-[300px] w-[300px] rounded-full bg-[var(--cobalt)]/[0.06] blur-[100px]" />
            <div className="mx-auto max-w-6xl px-6 text-center">
              <h2 className="text-3xl font-bold tracking-tight font-heading sm:text-4xl">
                Ready to orchestrate?
              </h2>
              <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
                Create agents, build workflow chains, and let Conductor handle the dispatch.
              </p>
              <Button
                className="mt-8 group inline-flex items-center gap-2 rounded-lg gradient-cobalt px-6 py-3 text-sm font-semibold text-white hover:shadow-glow-cobalt transition-shadow"
                onClick={() => setView('board')}
              >
                Launch Board
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t border-border/20 py-8">
          <div className="mx-auto max-w-6xl px-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src="/icon.png" alt="Conductor" className="h-5 w-5 rounded" />
              <span className="text-xs text-muted-foreground font-heading">Conductor</span>
            </div>
            <p className="text-xs text-muted-foreground/40">
              Agent orchestration platform
            </p>
          </div>
        </footer>
      </div>
    )
  }

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

  if (!isAdminAuthenticated) {
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
              <div className="grid gap-2">
                <label className="text-sm font-medium">Admin password</label>
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Enter admin password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleAdminLogin()
                    }
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

  // ===================== BOARD VIEW =====================
  return (
    <div className="min-h-screen bg-background dark">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--surface)]/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <a className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
              <img src="/icon.png" alt="Conductor" className="h-6 w-6 rounded-md" />
              <span className="text-sm font-semibold tracking-tight font-heading">Conductor</span>
            </a>

            <WorkspaceSwitcher
              currentWorkspaceId={currentWorkspaceId}
              onSwitch={(id) => setCurrentWorkspaceId(id)}
            />

            {/* WebSocket status */}
            <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono ${wsConnected ? 'bg-[var(--op-teal-bg)] text-[var(--op-teal)] border border-[var(--op-teal-dim)]' : 'bg-muted text-muted-foreground'}`}>
              <div className={`h-1.5 w-1.5 rounded-full ${wsConnected ? 'bg-[var(--op-teal)] animate-pulse' : 'bg-muted-foreground/50'}`} />
              {wsConnected ? 'Live' : realtimeConfigured ? 'Offline' : 'Realtime Off'}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Project selector */}
            {projects.length > 1 && (
              <Select value={currentProject?.id} onValueChange={switchProject}>
                <SelectTrigger className="w-[160px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
                        {p.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            {/* Agent status indicators — show active agents + overflow count */}
            {currentProject?.agents && (() => {
              const activeAgents = currentProject.agents.filter(a => a.isActive)
              const totalAgents = currentProject.agents.length
              const MAX_SHOWN = 5
              const shown = activeAgents.slice(0, MAX_SHOWN)
              const overflowCount = activeAgents.length - MAX_SHOWN

              return (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="hidden sm:flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-surface/40 transition-colors">
                      {shown.length > 0 ? shown.map((agent) => (
                        <div key={agent.id} className="relative">
                          <Avatar className="h-6 w-6 border border-border/30 bg-surface">
                            <AvatarFallback className="text-[10px] bg-transparent">{agent.emoji}</AvatarFallback>
                          </Avatar>
                          <div className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 ring-1 ring-background" />
                        </div>
                      )) : (
                        <span className="text-[10px] text-muted-foreground/50">No active agents</span>
                      )}
                      {overflowCount > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-0.5">+{overflowCount}</span>
                      )}
                      <span className="text-[9px] text-muted-foreground/40 ml-1">{activeAgents.length}/{totalAgents}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="end">
                    <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider px-2 py-1">
                      Agents ({activeAgents.length} active / {totalAgents} total)
                    </div>
                    <div className="max-h-[280px] overflow-y-auto space-y-0.5 mt-1">
                      {currentProject.agents
                        .slice()
                        .sort((a, b) => (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1))
                        .map((agent) => {
                          const taskCount = currentProject.tasks.filter(t => t.agent?.id === agent.id && t.status !== 'DONE').length
                          return (
                            <div key={agent.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] ${agent.isActive ? 'text-foreground/80' : 'text-muted-foreground/40'}`}>
                              <span className="text-sm">{agent.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate">{agent.name}</span>
                                  {agent.invocationMode === 'DAEMON' && (
                                    <span className="text-[8px] px-1 py-0 rounded bg-violet-500/15 text-violet-500 border border-violet-500/20 shrink-0">DAEMON</span>
                                  )}
                                </div>
                                {agent.role && (
                                  <span className="text-[9px] text-muted-foreground/50 capitalize">{agent.role}</span>
                                )}
                              </div>
                              {agent.isActive && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />}
                              {taskCount > 0 && <span className="text-[9px] text-muted-foreground/50">{taskCount}</span>}
                            </div>
                          )
                        })}
                    </div>
                  </PopoverContent>
                </Popover>
              )
            })()}
            
            {/* New Project button */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] gap-1"
              onClick={() => setProjectDialogOpen(true)}
            >
              <FolderPlus className="h-3 w-3" />
              <span className="hidden sm:inline">New Project</span>
            </Button>
            
            {/* Settings */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSettingsTab('general')}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'skills' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'skills' ? 'board' : 'skills')}
              title="Skills Library"
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'runtime' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'runtime' ? 'board' : 'runtime')}
              title="Runtime Dashboard"
            >
              <Activity className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${view === 'help' ? 'bg-accent' : ''}`}
              onClick={() => setView(view === 'help' ? 'board' : 'help')}
              title="Help & User Guide"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleAdminLogout}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm md:hidden pt-14">
          <div className="p-4">
            <div className="mb-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground/50 mb-2">Projects</h3>
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { switchProject(p.id); setSidebarOpen(false) }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm ${p.id === currentProject?.id ? 'bg-surface/60' : 'hover:bg-surface/40'}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="pt-14 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-56 shrink-0 border-r border-border/15 p-3 min-h-[calc(100vh-3.5rem)]">
          <div className="mb-4 flex items-center gap-1.5">
            <div className="h-3 w-3 rounded bg-primary/60" />
            <span className="text-[10px] font-medium text-foreground/50">Conductor {APP_VERSION_SHORT}</span>
          </div>
          
          <div className="mb-4">
            <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-2 px-2">Projects</h3>
            <div className="space-y-0.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchProject(p.id)}
                  className={`w-full text-left rounded-md px-2 py-1.5 text-[11px] font-medium flex items-center gap-2 ${p.id === currentProject?.id ? 'bg-surface/60 text-foreground/70' : 'text-muted-foreground/50 hover:bg-surface/40'}`}
                >
                  <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          
          <Separator className="my-4" />
          
          <div className="mt-4">
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center justify-between w-full px-2 mb-2 group">
                <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40">
                  Agents
                  {currentProject?.agents && (
                    <span className="ml-1.5 normal-case tracking-normal">
                      {currentProject.agents.filter(a => a.isActive).length}/{currentProject.agents.length}
                    </span>
                  )}
                </h3>
                <ChevronDown className="h-3 w-3 text-muted-foreground/30 transition-transform group-data-[state=closed]:-rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="max-h-[220px] overflow-y-auto space-y-0.5">
                  {currentProject?.agents
                    .slice()
                    .sort((a, b) => {
                      // Active first, then by task count, then alphabetical
                      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
                      const aCount = currentProject.tasks.filter(t => t.agent?.id === a.id && t.status !== 'DONE').length
                      const bCount = currentProject.tasks.filter(t => t.agent?.id === b.id && t.status !== 'DONE').length
                      if (aCount !== bCount) return bCount - aCount
                      return a.name.localeCompare(b.name)
                    })
                    .map((agent) => {
                      const taskCount = currentProject!.tasks.filter(t => t.agent?.id === agent.id && t.status !== 'DONE').length
                      return (
                        <div
                          key={agent.id}
                          className={`flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface/40 transition-colors cursor-pointer ${
                            !agent.isActive && taskCount === 0 ? 'opacity-40' : ''
                          }`}
                          onClick={() => openEditAgentDialog(agent)}
                        >
                          <span className="text-sm">{agent.emoji}</span>
                          <span className="text-[11px] text-foreground/70 flex-1 truncate">{agent.name}</span>
                          {agent.isActive && (
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                          )}
                          {taskCount > 0 && (
                            <span className="text-[9px] text-muted-foreground/50 shrink-0">{taskCount}</span>
                          )}
                        </div>
                      )
                    })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          
          <Separator className="my-4" />
          
          <div className="mt-4">
            <h3 className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/40 mb-2 px-2">Tags</h3>
            <div className="flex flex-wrap gap-1 px-2">
              {Array.from(new Set(currentProject?.tasks.map(t => t.tag).filter(Boolean))).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="p-3 border-t border-border/20 space-y-2">
            <Button
              variant="outline"
              className="w-full text-xs"
              onClick={() => { setEditingAgent(null); setAgentDialogOpen(true) }}
            >
              <Plus className="h-3 w-3 mr-2" />
              Create Agent
            </Button>
            <Button
              variant="outline"
              className="w-full text-xs"
              onClick={openNewChainDialog}
            >
              <Plus className="h-3 w-3 mr-2" />
              Create Chain
            </Button>
          </div>
        </aside>

        {/* Board */}
        <div className="flex-1 overflow-hidden">
          {authError && (
            <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {authError}
            </div>
          )}
          {view === 'runtime' ? (
            <div className="p-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold">Runtime Dashboard</h2>
                <Button variant="outline" size="sm" onClick={() => setView('board')}>
                  Back to Board
                </Button>
              </div>
              <RuntimeDashboard daemonLogs={daemonLogs} />
            </div>
          ) : view === 'skills' ? (
            <div className="p-6 max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div />
                <Button variant="outline" size="sm" onClick={() => setView('board')}>
                  Back to Board
                </Button>
              </div>
              <SkillsPage workspaceId={currentWorkspaceId} />
            </div>
          ) : view === 'help' ? (
            <HelpPage onBack={() => setView('board')} />
          ) : loading ? (
            <div className="flex items-center justify-center h-[calc(100vh-3.5rem)]">
              <div className="flex flex-col items-center gap-3">
                <Sparkles className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
                <span className="text-sm text-muted-foreground">Loading board...</span>
              </div>
            </div>
          ) : !currentProject ? (
            <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center px-6">
              <div className="max-w-md rounded-2xl border border-border/30 bg-card p-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40">
                  <FolderPlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <h2 className="text-lg font-semibold">No projects yet</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start with a real project, or load demo data explicitly for a local evaluation environment.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setProjectDialogOpen(true)}>
                    Create Project
                  </Button>
                  {showDemoSeed && (
                    <Button
                      variant="outline"
                      onClick={handleSeedDemoData}
                      disabled={seedingDemoData}
                    >
                      <RefreshCw className={`mr-2 h-4 w-4 ${seedingDemoData ? 'animate-spin' : ''}`} />
                      Load Demo Data
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-3.5rem)] custom-scrollbar">
              <div className="p-4">
                {/* Mobile column tabs — only visible below 480px */}
                <div className="flex xs:hidden gap-1 mb-3 overflow-x-auto pb-1">
                  {statusColumns.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => setMobileColumn(col.id as TaskStatus)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        mobileColumn === col.id
                          ? 'bg-card border border-border/30 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {col.label}
                      <span className="ml-1.5 text-[10px] opacity-60">
                        {getTasksByStatus(col.id).length}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Board grid — desktop: 5-col grid; tablet (480-768px): horizontal scroll; mobile: hidden */}
                <div className="hidden xs:flex md:grid md:grid-cols-5 xs:flex-nowrap gap-4 overflow-x-auto">
                  {statusColumns.map((column) => {
                    const tasks = getTasksByStatus(column.id)
                    return (
                      <div
                        key={column.id}
                        className="min-w-[280px] md:min-w-0"
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(column.id)}
                      >
                        <div className="mb-3 flex items-center justify-between px-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] font-medium uppercase tracking-wider ${column.color}`}>
                              {column.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground/30">{tasks.length}</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 hover:opacity-100 group-hover:opacity-50 transition-opacity"
                            onClick={() => openNewTaskDialog(column.id)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          {tasks.map((task) => (
                            <div
                              key={task.id}
                              draggable
                              onDragStart={() => handleDragStart(task)}
                              onClick={() => setSelectedTask(task)}
                              className="group relative rounded-lg border border-border/40 bg-card p-3 cursor-pointer hover:border-border/60 transition-colors"
                            >
                              <div className="flex items-start gap-2">
                                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/20 mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-1.5">
                                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${priorityColors[task.priority]}`} />
                                      <span className="text-[13px] font-medium leading-tight text-foreground/90">{task.title}</span>
                                    </div>
                                    {task.agent && (
                                      <span className="text-[11px] shrink-0" title={task.agent.name}>
                                        {task.agent.emoji}
                                      </span>
                                    )}
                                  </div>
                                  
                                  {task.steps && task.steps.length > 0 && (() => {
                                    const activeStep = task.steps.find((s) => s.status === 'active')
                                    const doneCount = task.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
                                    const currentStep = activeStep || task.steps[doneCount]
                                    if (!currentStep) return null
                                    return (
                                      <div className="text-[10px] font-mono text-muted-foreground mt-1">
                                        Step {currentStep.order}/{task.steps.length} · {currentStep.mode}
                                      </div>
                                    )
                                  })()}

                                  {task.steps && task.steps.length > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setViewingTaskSteps({ id: task.id, title: task.title, steps: task.steps || [] }) }}
                                      className="absolute top-2 right-2 p-1 rounded hover:bg-card/80 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                    >
                                      <Eye className="h-3 w-3" />
                                    </button>
                                  )}

                                  {task.notes && (
                                    <div className="mt-2 rounded-md bg-surface/60 px-2 py-1.5">
                                      <p className="text-[10px] leading-snug text-muted-foreground line-clamp-2">{task.notes}</p>
                                    </div>
                                  )}
                                  
                                  <div className="mt-2 flex items-center justify-between">
                                    {task.tag ? (
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] ${tagColors[task.tag] || 'bg-surface text-muted-foreground'}`}>
                                        {task.tag}
                                      </span>
                                    ) : (
                                      <div />
                                    )}
                                    
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5"
                                        onClick={(e) => { e.stopPropagation(); openEditTaskDialog(task) }}
                                      >
                                        <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id) }}
                                      >
                                        <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                          
                          {/* Add task button */}
                          <button
                            onClick={() => openNewTaskDialog(column.id)}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70 transition-colors"
                          >
                            <Plus className="h-3 w-3" />
                            Add task
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Mobile: single column view — only visible below 480px */}
                <div className="xs:hidden">
                  {statusColumns
                    .filter((col) => col.id === mobileColumn)
                    .map((column) => {
                      const columnTasks = getTasksByStatus(column.id)
                      return (
                        <div key={column.id} className="space-y-2">
                          <div className={`text-sm font-medium ${column.color} mb-2`}>
                            {column.label}
                            <span className="ml-2 text-xs opacity-60">{columnTasks.length}</span>
                          </div>
                          {columnTasks.map((task) => (
                            <div
                              key={task.id}
                              className="group relative rounded-lg border border-border/40 bg-card p-3 cursor-pointer hover:border-border/60 transition-colors"
                              onClick={() => setSelectedTask(task)}
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-1.5">
                                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${priorityColors[task.priority]}`} />
                                      <span className="text-[13px] font-medium leading-tight text-foreground/90">{task.title}</span>
                                    </div>
                                    {task.agent && (
                                      <span className="text-[11px] shrink-0" title={task.agent.name}>
                                        {task.agent.emoji}
                                      </span>
                                    )}
                                  </div>

                                  {task.steps && task.steps.length > 0 && (() => {
                                    const activeStep = task.steps.find((s) => s.status === 'active')
                                    const doneCount = task.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
                                    const currentStep = activeStep || task.steps[doneCount]
                                    if (!currentStep) return null
                                    return (
                                      <div className="text-[10px] font-mono text-muted-foreground mt-1">
                                        Step {currentStep.order}/{task.steps.length} · {currentStep.mode}
                                      </div>
                                    )
                                  })()}

                                  {task.steps && task.steps.length > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setViewingTaskSteps({ id: task.id, title: task.title, steps: task.steps || [] }) }}
                                      className="absolute top-2 right-2 p-1 rounded hover:bg-card/80 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                                    >
                                      <Eye className="h-3 w-3" />
                                    </button>
                                  )}

                                  {task.notes && (
                                    <div className="mt-2 rounded-md bg-surface/60 px-2 py-1.5">
                                      <p className="text-[10px] leading-snug text-muted-foreground line-clamp-2">{task.notes}</p>
                                    </div>
                                  )}

                                  <div className="mt-2 flex items-center justify-between">
                                    {task.tag ? (
                                      <span className={`rounded px-1.5 py-0.5 text-[9px] ${tagColors[task.tag] || 'bg-surface text-muted-foreground'}`}>
                                        {task.tag}
                                      </span>
                                    ) : (
                                      <div />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* Add task button */}
                          <button
                            onClick={() => openNewTaskDialog(column.id)}
                            className="flex items-center gap-2 rounded-lg border border-dashed border-border/30 p-2 text-[11px] text-muted-foreground/50 hover:border-border/50 hover:text-muted-foreground/70 transition-colors w-full"
                          >
                            <Plus className="h-3 w-3" />
                            Add task
                          </button>

                          {columnTasks.length === 0 && (
                            <div className="text-xs text-muted-foreground/40 text-center py-8">
                              No tasks
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </main>

      {/* Task Dialog */}
      <Dialog open={taskDialogOpen} onOpenChange={(open) => { setTaskDialogOpen(open); if (!open) resetTaskForm() }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingTask ? 'Edit Task' : 'Create New Task'}</DialogTitle>
            <DialogDescription>
              {editingTask ? 'Update the task details below.' : 'Add a new task to your board.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="Enter task title..."
              />
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={taskDescription}
                onChange={(e) => setTaskDescription(e.target.value)}
                placeholder="Enter task description..."
                rows={2}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={taskStatus} onValueChange={(v) => setTaskStatus(v as TaskStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusColumns.map((col) => (
                      <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={taskPriority} onValueChange={(v) => setTaskPriority(v as TaskPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Tag</label>
                <Select value={taskTag} onValueChange={setTaskTag}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select tag..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="research">research</SelectItem>
                    <SelectItem value="docs">docs</SelectItem>
                    <SelectItem value="backend">backend</SelectItem>
                    <SelectItem value="frontend">frontend</SelectItem>
                    <SelectItem value="devops">devops</SelectItem>
                    <SelectItem value="copy">copy</SelectItem>
                    <SelectItem value="design">design</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="grid gap-2">
                <label className="text-sm font-medium">Agent</label>
                <Select value={taskAgentId} onValueChange={setTaskAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Assign agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {currentProject?.agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.emoji} {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Runtime Override</label>
              <Select value={taskRuntimeOverride} onValueChange={setTaskRuntimeOverride}>
                <SelectTrigger>
                  <SelectValue placeholder="Use agent default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use agent default</SelectItem>
                  <SelectItem value="claude-code">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                  <SelectItem value="copilot">GitHub Copilot</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Override the runtime for this specific task (daemon mode only).</p>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={taskNotes}
                onChange={(e) => setTaskNotes(e.target.value)}
                placeholder="Progress notes, status updates..."
                rows={2}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Workflow Chain</label>
              <ChainBuilder
                projectId={currentProject?.id || ''}
                agents={currentProject?.agents || []}
                modes={projectModes}
                templates={chainTemplates}
                steps={taskSteps}
                onStepsChange={setTaskSteps}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setTaskDialogOpen(false); resetTaskForm() }}>
              Cancel
            </Button>
            <Button onClick={handleSaveTask}>
              {editingTask ? 'Save Changes' : 'Create Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Chain Creation Dialog */}
      <Dialog open={chainDialogOpen} onOpenChange={(open) => { setChainDialogOpen(open); if (!open) resetTaskForm() }}>
        <DialogContent className="sm:max-w-[780px] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Create Chain Task</DialogTitle>
            <DialogDescription>
              Select a template or build a custom workflow chain, then create a task that runs through it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Task Title</label>
                <Input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="What should this chain accomplish?"
                  autoFocus
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  placeholder="Context and requirements for the chain..."
                  rows={2}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={taskPriority} onValueChange={(v) => setTaskPriority(v as TaskPriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="URGENT">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Workflow</label>
                <ChainBuilder
                  projectId={currentProject?.id || ''}
                  agents={currentProject?.agents || []}
                  modes={projectModes}
                  templates={chainTemplates}
                  steps={taskSteps}
                  onStepsChange={setTaskSteps}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => { setChainDialogOpen(false); resetTaskForm() }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateChain}
              disabled={!taskTitle.trim() || taskSteps.length === 0}
            >
              Create Chain Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Project Dialog */}
      <Dialog
        open={projectDialogOpen}
        onOpenChange={(open) => {
          setProjectDialogOpen(open)
          if (!open) {
            resetProjectForm()
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Create a new project to organize your agents and tasks.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Project Name</label>
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My Project"
              />
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={projectDescription}
                onChange={(e) => setProjectDescription(e.target.value)}
                placeholder="Brief description..."
                rows={2}
              />
            </div>
            
            <div className="grid gap-2">
              <label className="text-sm font-medium">Color</label>
              <div className="flex gap-2">
                {['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'].map((color) => (
                  <button
                    key={color}
                    onClick={() => setProjectColor(color)}
                    className={`h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-background ${projectColor === color ? 'ring-foreground' : 'ring-transparent'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border/30 p-3">
              <Checkbox
                id="create-starter-agents"
                checked={createStarterAgents}
                onCheckedChange={(checked) => setCreateStarterAgents(checked === true)}
              />
              <div className="grid gap-1">
                <label htmlFor="create-starter-agents" className="text-sm font-medium">
                  Add starter agents
                </label>
                <p className="text-xs text-muted-foreground">
                  Pre-create Coder, Research, Writer, and QA agents for faster onboarding.
                </p>
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProject}>Create Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsTab !== null} onOpenChange={(open) => !open && setSettingsTab(null)}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Project Settings</DialogTitle>
          </DialogHeader>
          
          <Tabs value={settingsTab || 'general'} onValueChange={(v) => setSettingsTab(v as NonNullable<typeof settingsTab>)}>
            <TabsList className="flex flex-wrap gap-1 w-full">
              <TabsTrigger value="general" className="text-xs">General</TabsTrigger>
              <TabsTrigger value="agents" className="text-xs">Agents</TabsTrigger>
              <TabsTrigger value="api" className="text-xs">API Keys</TabsTrigger>
              <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
              <TabsTrigger value="modes" className="text-xs">Modes</TabsTrigger>
              <TabsTrigger value="runtimes" className="text-xs">Runtimes</TabsTrigger>
              <TabsTrigger value="mcp" className="text-xs">MCP</TabsTrigger>
              <TabsTrigger value="templates" className="text-xs">Templates</TabsTrigger>
              <TabsTrigger value="analytics" className="text-xs">Analytics</TabsTrigger>
              <TabsTrigger value="automation" className="text-xs">Automation</TabsTrigger>
            </TabsList>
            
            <div className="mt-4 overflow-y-auto max-h-[50vh]">
              {/* General Tab */}
              <TabsContent value="general" className="mt-0">
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Project Name</label>
                    <Input value={currentProject?.name || ''} readOnly />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Description</label>
                    <Textarea value={currentProject?.description || ''} readOnly rows={2} />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium">Tasks Summary</label>
                    <div className="grid grid-cols-5 gap-2 text-center">
                      {statusColumns.map((col) => (
                        <div key={col.id} className="rounded-lg bg-muted/30 p-2">
                          <div className="text-lg font-bold">{getTasksByStatus(col.id).length}</div>
                          <div className="text-[10px] text-muted-foreground">{col.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              {/* Agents Tab */}
              <TabsContent value="agents" className="mt-0">
                <div className="space-y-3">
                  {currentProject?.agents.map((agent) => (
                    <div key={agent.id} className="rounded-lg border border-border/30">
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{agent.emoji}</span>
                          <div>
                            <div className="text-sm font-medium flex items-center gap-2">
                              {agent.name}
                              {agent.isActive && (
                                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                  Active
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{agent.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setExpandedAgentStats(expandedAgentStats === agent.id ? null : agent.id)}>
                            <Activity className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditAgentDialog(agent)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDeleteAgent(agent.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {expandedAgentStats === agent.id && (
                        <div className="px-3 pb-3">
                          <AgentActivityDashboard agentId={agent.id} />
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <Button variant="outline" className="w-full" onClick={() => { resetAgentForm(); setAgentDialogOpen(true) }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Agent
                  </Button>
                </div>
              </TabsContent>
              
              {/* API Keys Tab */}
              <TabsContent value="api" className="mt-0">
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/30 p-4">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Key className="h-4 w-4" />
                      Project API Key
                    </h4>
                    <p className="text-xs text-muted-foreground mb-2">Loaded on demand and managed separately from general project data. Raw keys are shown only immediately after rotation.</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-muted/30 px-3 py-2 rounded font-mono">
                        {loadingApiKeys ? 'Loading...' : projectApiKey || projectApiPreview || 'Rotate to generate a new key'}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => projectApiKey && copyToClipboard(projectApiKey, 'project')}
                        disabled={!projectApiKey}
                      >
                        {copiedKey === 'project' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={rotateProjectApiKey}
                        disabled={loadingApiKeys || rotatingKeyId === 'project'}
                      >
                        <RefreshCw className={`h-3 w-3 ${rotatingKeyId === 'project' ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="rounded-lg border border-border/30 p-4">
                    <h4 className="text-sm font-medium mb-3">Agent API Keys</h4>
                    <p className="text-xs text-muted-foreground mb-3">Keys are requested only when this tab is opened. Rotating a key invalidates the old one immediately, and the raw value is only available during that response.</p>
                    <div className="space-y-2">
                      {currentProject?.agents.map((agent) => (
                        <div key={agent.id} className="flex items-center gap-2 p-2 rounded bg-muted/20">
                          <span>{agent.emoji}</span>
                          <span className="text-xs flex-1 font-mono truncate">
                            {loadingApiKeys
                              ? 'Loading...'
                              : agentApiKeys[agent.id] || agentApiPreviews[agent.id] || 'Rotate to generate a new key'}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => rotateAgentApiKey(agent.id)}
                            disabled={loadingApiKeys || rotatingKeyId === agent.id}
                          >
                            <RefreshCw className={`h-3 w-3 ${rotatingKeyId === agent.id ? 'animate-spin' : ''}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => agentApiKeys[agent.id] && copyToClipboard(agentApiKeys[agent.id], agent.id)}
                            disabled={!agentApiKeys[agent.id]}
                          >
                            {copiedKey === agent.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/30 p-4">
                    <h4 className="text-sm font-medium mb-2">Legacy Key Storage</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Older records may still have plaintext keys stored in the database. Migrate them once to hash-only storage without changing the secrets your agents already use.
                    </p>
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-muted-foreground">
                        {legacyKeyStatus
                          ? `${legacyKeyStatus.totalWithPlaintext} plaintext keys remaining (${legacyKeyStatus.projectsWithPlaintext} project, ${legacyKeyStatus.agentsWithPlaintext} agent)`
                          : 'Checking key storage status...'}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={migrateLegacyKeys}
                        disabled={loadingApiKeys || migratingLegacyKeys || !legacyKeyStatus || legacyKeyStatus.totalWithPlaintext === 0}
                      >
                        <RefreshCw className={`h-3 w-3 mr-2 ${migratingLegacyKeys ? 'animate-spin' : ''}`} />
                        Migrate Legacy Keys
                      </Button>
                    </div>
                  </div>
                  
                  <div className="rounded-lg border border-border/30 p-4">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <ExternalLink className="h-4 w-4" />
                      API Endpoints
                    </h4>
                    <div className="space-y-2 text-xs font-mono">
                      <div className="p-2 rounded bg-muted/20">
                        <div className="text-muted-foreground"># Get agent tasks</div>
                        <div>GET /api/agent/tasks</div>
                        <div>Authorization: Bearer <span className="text-emerald-400">AGENT_KEY</span></div>
                      </div>
                      <div className="p-2 rounded bg-muted/20">
                        <div className="text-muted-foreground"># CLI-style interface</div>
                        <div>GET /api/cli</div>
                        <div>Authorization: Bearer <span className="text-emerald-400">AGENT_KEY</span></div>
                      </div>
                      <div className="p-2 rounded bg-muted/20">
                        <div className="text-muted-foreground"># Task actions</div>
                        <div>PUT /api/agent/tasks/:id</div>
                        <div>{"{"} action: "claim"|"start"|"complete" {"}"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
              
              {/* Activity Tab */}
              <TabsContent value="activity" className="mt-0">
                <div className="space-y-2">
                  {activities.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No activity yet
                    </div>
                  ) : (
                    activities.map((activity) => (
                      <div key={activity.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/20">
                        <span className="text-lg">{activity.agent?.emoji || '📋'}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm">
                            <span className="font-medium">{activity.agent?.name || 'System'}</span>
                            <span className="text-muted-foreground ml-2">{activity.action}</span>
                          </div>
                          {activity.details && (
                            <div className="text-xs text-muted-foreground truncate">{activity.details}</div>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground/50">{timeAgo(activity.createdAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              <TabsContent value="modes" className="mt-0">
                {currentProject && (
                  <SettingsModes
                    projectId={currentProject.id}
                    modes={projectModes}
                    onModesChange={setProjectModes}
                  />
                )}
              </TabsContent>

              <TabsContent value="runtimes" className="mt-0">
                {currentProject && (
                  <SettingsRuntimes
                    projectId={currentProject.id}
                    runtimes={projectRuntimes}
                    onRuntimesChange={setProjectRuntimes}
                  />
                )}
              </TabsContent>

              <TabsContent value="mcp" className="mt-0">
                {currentProject && (
                  <SettingsMcp
                    projectId={currentProject.id}
                    connections={projectMcpConnections}
                    onConnectionsChange={setProjectMcpConnections}
                  />
                )}
              </TabsContent>

              <TabsContent value="templates" className="mt-0">
                {currentProject && (
                  <SettingsTemplates
                    projectId={currentProject.id}
                    templates={chainTemplates}
                    modes={projectModes}
                    onTemplatesChange={setChainTemplates}
                  />
                )}
              </TabsContent>

              <TabsContent value="analytics" className="mt-0">
                {currentProject && (
                  <ObservabilityDashboard projectId={currentProject.id} />
                )}
              </TabsContent>

              <TabsContent value="automation" className="mt-0">
                {currentProject && (
                  <SettingsAutomation projectId={currentProject.id} />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Agent Dialog */}
      <AgentCreationModal
        open={agentDialogOpen}
        onOpenChange={(open) => { setAgentDialogOpen(open); if (!open) { setEditingAgent(null) } }}
        projectId={currentProject?.id || ''}
        editingAgent={editingAgent}
        modes={projectModes}
        runtimes={projectRuntimes}
        mcpConnections={projectMcpConnections}
        onSave={(agent) => {
          if (editingAgent) {
            setCurrentProject(prev => prev ? {
              ...prev,
              agents: prev.agents.map(a => a.id === agent.id ? agent : a),
            } : null)
          } else {
            setCurrentProject(prev => prev ? {
              ...prev,
              agents: [...prev.agents, agent],
            } : null)
          }
          setAgentDialogOpen(false)
          setEditingAgent(null)
        }}
      />

      {viewingTaskSteps && (
        <StepOutputViewer
          taskId={viewingTaskSteps.id}
          taskTitle={viewingTaskSteps.title}
          steps={viewingTaskSteps.steps}
          onClose={() => setViewingTaskSteps(null)}
          onRefresh={() => {
            if (currentProject) fetchProject(currentProject.id).then(setCurrentProject)
          }}
        />
      )}

      {selectedTask && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={() => setSelectedTask(null)} />
          <TaskDetailDrawer
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
            onEdit={() => {
              openEditTaskDialog(selectedTask)
              setSelectedTask(null)
            }}
            onRefresh={() => {
              if (currentProject) fetchProject(currentProject.id).then(p => {
                setCurrentProject(p)
                if (p) {
                  const updated = p.tasks?.find((t) => t.id === selectedTask.id)
                  if (updated) setSelectedTask(updated)
                }
              })
            }}
          />
        </>
      )}
    </div>
  )
}
