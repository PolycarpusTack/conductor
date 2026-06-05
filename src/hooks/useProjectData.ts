'use client'

import { useState, useCallback, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import type { Project, ProjectListItem, Activity } from '@/types/board'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'

export function useProjectData() {
  const { toast } = useToast()

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)
  const [seedingDemoData, setSeedingDemoData] = useState(false)

  // Project settings
  const [projectModes, setProjectModes] = useState<ProjectMode[]>([])
  const [projectRuntimes, setProjectRuntimes] = useState<ProjectRuntime[]>([])
  const [projectMcpConnections, setProjectMcpConnections] = useState<ProjectMcpConnection[]>([])
  const [chainTemplates, setChainTemplates] = useState<ChainTemplate[]>([])
  const [triggers, setTriggers] = useState<IntegrationTrigger[]>([])

  // API key state
  const [projectApiKey, setProjectApiKey] = useState<string | null>(null)
  const [projectApiPreview, setProjectApiPreview] = useState<string | null>(null)
  const [agentApiKeys, setAgentApiKeys] = useState<Record<string, string>>({})
  const [agentApiPreviews, setAgentApiPreviews] = useState<Record<string, string>>({})
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null)
  const [legacyKeyStatus, setLegacyKeyStatus] = useState<{ projectsWithPlaintext: number; agentsWithPlaintext: number; totalWithPlaintext: number } | null>(null)
  const [migratingLegacyKeys, setMigratingLegacyKeys] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Project creation form
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectColor, setProjectColor] = useState('#3b82f6')
  const [createStarterAgents, setCreateStarterAgents] = useState(true)

  // Reset API key state when project changes
  useEffect(() => {
    setProjectApiKey(null)
    setProjectApiPreview(null)
    setAgentApiKeys({})
    setAgentApiPreviews({})
    setLegacyKeyStatus(null)
    setTriggers([])
  }, [currentProject?.id])

  const readApiError = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = await response.json()
      return payload?.error || fallback
    } catch {
      return fallback
    }
  }, [])

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects')
      if (!res.ok) return []
      const data: ProjectListItem[] = await res.json()
      setProjects(data)
      return data
    } catch (error) {
      console.error('Error fetching projects:', error)
      return []
    }
  }, [])

  const fetchProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) return null
      return await res.json() as Project
    } catch (error) {
      console.error('Error fetching project:', error)
      return null
    }
  }, [])

  const fetchActivities = useCallback(async (projectId: string) => {
    const actRes = await fetch(`/api/activity?projectId=${projectId}&limit=20`)
    if (!actRes.ok) {
      setActivities([])
      toast({ title: 'Failed to load activity', variant: 'destructive' })
      return
    }
    setActivities(await actRes.json())
  }, [toast])

  const fetchProjectSettings = useCallback(async (projectId: string) => {
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
      const triggersRes = await fetch(`/api/projects/${projectId}/triggers`)
      if (triggersRes.ok) setTriggers(await triggersRes.json())
    } catch (error) {
      console.error('Error fetching project settings:', error)
      toast({ title: 'Failed to load project settings', variant: 'destructive' })
    }
  }, [toast])

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
  }, [fetchProjects, fetchProject, fetchActivities, fetchProjectSettings])

  const switchProject = useCallback(async (projectId: string) => {
    const project = await fetchProject(projectId)
    if (!project) return
    setCurrentProject(project)
    await fetchActivities(project.id)
    await fetchProjectSettings(project.id)
  }, [fetchProject, fetchActivities, fetchProjectSettings])

  const resetProjectForm = useCallback(() => {
    setProjectName('')
    setProjectDescription('')
    setProjectColor('#3b82f6')
    setCreateStarterAgents(true)
  }, [])

  const handleCreateProject = useCallback(async () => {
    if (!projectName.trim()) return
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, description: projectDescription, color: projectColor }),
      })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to create project'), variant: 'destructive' })
        return
      }
      const newProject: ProjectListItem = await res.json()
      setProjects(prev => [newProject, ...prev])
      resetProjectForm()
      setProjectDialogOpen(false)

      // Agents are seeded server-side — just fetch the full project
      const updated = await fetchProject(newProject.id)
      setCurrentProject(updated)
      if (updated) {
        await fetchActivities(updated.id)
        await fetchProjectSettings(updated.id)
      }
    } catch (error) {
      console.error('Error creating project:', error)
      toast({ title: 'Failed to create project', variant: 'destructive' })
    }
  }, [projectName, projectDescription, projectColor, fetchProject, fetchActivities, fetchProjectSettings, readApiError, resetProjectForm, toast])

  const handleSeedDemoData = useCallback(async () => {
    setSeedingDemoData(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to load demo data'), variant: 'destructive' })
        return
      }
      await initializeBoard()
    } catch (error) {
      console.error('Error loading demo data:', error)
      toast({ title: 'Failed to load demo data', variant: 'destructive' })
    } finally {
      setSeedingDemoData(false)
    }
  }, [initializeBoard, readApiError, toast])

  // --- API Key management ---

  const fetchLegacyKeyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/security/keys', { cache: 'no-store' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to load API key security status'), variant: 'destructive' })
        return
      }
      setLegacyKeyStatus(await res.json())
    } catch (error) {
      console.error('Error loading API key security status:', error)
      toast({ title: 'Failed to load API key security status', variant: 'destructive' })
    }
  }, [readApiError, toast])

  const loadApiKeys = useCallback(async (project: Project) => {
    setLoadingApiKeys(true)
    setCopiedKey(null)
    try {
      const projectRes = await fetch(`/api/projects/${project.id}/key`, { cache: 'no-store' })
      if (!projectRes.ok) {
        toast({ title: await readApiError(projectRes, 'Failed to load project API key'), variant: 'destructive' })
        return
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
      toast({ title: error instanceof Error ? error.message : 'Failed to load API keys', variant: 'destructive' })
    } finally {
      setLoadingApiKeys(false)
    }
  }, [readApiError, toast])

  const rotateProjectApiKey = useCallback(async () => {
    if (!currentProject) return
    setRotatingKeyId('project')
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/key`, { method: 'POST' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to rotate project API key'), variant: 'destructive' })
        return
      }
      const payload = await res.json()
      setProjectApiKey(payload.apiKey || null)
      setProjectApiPreview(payload.preview || null)
      setCopiedKey((current) => (current === 'project' ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      console.error('Error rotating project API key:', error)
      toast({ title: 'Failed to rotate project API key', variant: 'destructive' })
    } finally {
      setRotatingKeyId(null)
    }
  }, [currentProject, fetchLegacyKeyStatus, readApiError, toast])

  const rotateAgentApiKey = useCallback(async (agentId: string) => {
    setRotatingKeyId(agentId)
    try {
      const res = await fetch(`/api/agents/${agentId}/key`, { method: 'POST' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to rotate agent API key'), variant: 'destructive' })
        return
      }
      const payload = await res.json()
      setAgentApiKeys((prev) => ({ ...prev, [agentId]: payload.apiKey || '' }))
      setAgentApiPreviews((prev) => ({ ...prev, [agentId]: payload.preview || prev[agentId] || '' }))
      setCopiedKey((current) => (current === agentId ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      console.error('Error rotating agent API key:', error)
      toast({ title: 'Failed to rotate agent API key', variant: 'destructive' })
    } finally {
      setRotatingKeyId(null)
    }
  }, [fetchLegacyKeyStatus, readApiError, toast])

  const migrateLegacyKeys = useCallback(async () => {
    if (!currentProject) return
    setMigratingLegacyKeys(true)
    try {
      const res = await fetch('/api/admin/security/keys', { method: 'POST' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to migrate legacy API keys'), variant: 'destructive' })
        return
      }
      await Promise.all([loadApiKeys(currentProject), fetchLegacyKeyStatus()])
    } catch (error) {
      console.error('Error migrating legacy API keys:', error)
      toast({ title: 'Failed to migrate legacy API keys', variant: 'destructive' })
    } finally {
      setMigratingLegacyKeys(false)
    }
  }, [currentProject, fetchLegacyKeyStatus, loadApiKeys, readApiError, toast])

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  return {
    // Project list & current project
    projects,
    setProjects,
    currentProject,
    setCurrentProject,
    activities,
    setActivities,
    loading,
    seedingDemoData,

    // Project settings
    projectModes,
    setProjectModes,
    projectRuntimes,
    setProjectRuntimes,
    projectMcpConnections,
    setProjectMcpConnections,
    chainTemplates,
    setChainTemplates,
    triggers,
    setTriggers,

    // API keys
    projectApiKey,
    projectApiPreview,
    agentApiKeys,
    agentApiPreviews,
    loadingApiKeys,
    rotatingKeyId,
    legacyKeyStatus,
    migratingLegacyKeys,
    copiedKey,

    // Project creation form
    projectDialogOpen,
    setProjectDialogOpen,
    projectName,
    setProjectName,
    projectDescription,
    setProjectDescription,
    projectColor,
    setProjectColor,
    createStarterAgents,
    setCreateStarterAgents,

    // Actions
    fetchProjects,
    fetchProject,
    fetchActivities,
    fetchProjectSettings,
    initializeBoard,
    switchProject,
    handleCreateProject,
    handleSeedDemoData,
    resetProjectForm,
    loadApiKeys,
    fetchLegacyKeyStatus,
    rotateProjectApiKey,
    rotateAgentApiKey,
    migrateLegacyKeys,
    copyToClipboard,
  }
}
