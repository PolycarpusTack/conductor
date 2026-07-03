'use client'

import { useState, useCallback, useEffect } from 'react'
import { useToast } from '@/hooks/use-toast'
import { ApiClientError, swallowApiClientError } from '@/lib/api/client'
import { activityApi, adminApi, agentsApi, projectsApi, seedApi } from '@/lib/api/endpoints'
import type { Project, ProjectListItem, Activity } from '@/types/board'
import type { LegacyApiKeyStatus } from '@/types/api'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate, TaskTemplate } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'

export function useProjectData() {
  const { toast } = useToast()

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [seedingDemoData, setSeedingDemoData] = useState(false)

  // Project settings
  const [projectModes, setProjectModes] = useState<ProjectMode[]>([])
  const [projectRuntimes, setProjectRuntimes] = useState<ProjectRuntime[]>([])
  const [projectMcpConnections, setProjectMcpConnections] = useState<ProjectMcpConnection[]>([])
  const [chainTemplates, setChainTemplates] = useState<ChainTemplate[]>([])
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([])
  const [triggers, setTriggers] = useState<IntegrationTrigger[]>([])
  // Which project the settings above (runtimes, modes, …) belong to. Lets
  // consumers avoid acting on another project's stale settings mid-switch.
  const [settingsSyncedProjectId, setSettingsSyncedProjectId] = useState<string | null>(null)

  // API key state
  const [projectApiKey, setProjectApiKey] = useState<string | null>(null)
  const [projectApiPreview, setProjectApiPreview] = useState<string | null>(null)
  const [agentApiKeys, setAgentApiKeys] = useState<Record<string, string>>({})
  const [agentApiPreviews, setAgentApiPreviews] = useState<Record<string, string>>({})
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null)
  const [legacyKeyStatus, setLegacyKeyStatus] = useState<LegacyApiKeyStatus | null>(null)
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

  const fetchProjects = useCallback(async () => {
    try {
      const data = await projectsApi.list({ errorFallback: 'Failed to load projects' })
      setProjects(data)
      setLoadError(null)
      return data
    } catch (error) {
      if (error instanceof ApiClientError) {
        setLoadError(error.message)
        return []
      }
      console.error('Error fetching projects:', error)
      setLoadError('Failed to load projects. Check your connection and try again.')
      return []
    }
  }, [])

  const fetchProject = useCallback(async (projectId: string) => {
    try {
      const project = await projectsApi.get(projectId, { errorFallback: 'Failed to load project' })
      setLoadError(null)
      return project
    } catch (error) {
      if (error instanceof ApiClientError) {
        setLoadError(error.message)
        return null
      }
      console.error('Error fetching project:', error)
      setLoadError('Failed to load project. Check your connection and try again.')
      return null
    }
  }, [])

  const fetchActivities = useCallback(async (projectId: string) => {
    let data: Activity[]
    try {
      data = await activityApi.list(projectId, 20)
    } catch (error) {
      // API error → empty list + toast (as before); network errors propagate.
      if (error instanceof ApiClientError) {
        setActivities([])
        toast({ title: 'Failed to load activity', variant: 'destructive' })
        return
      }
      throw error
    }
    setActivities(data)
  }, [toast])

  const fetchProjectSettings = useCallback(async (projectId: string) => {
    try {
      // API errors on individual collections are skipped silently (matching
      // the old `if (res.ok)` guards); network errors fall through to catch.
      const [modes, runtimes, mcpConnections, templates, fetchedTaskTemplates] = await Promise.all([
        swallowApiClientError(projectsApi.modes(projectId)),
        swallowApiClientError(projectsApi.runtimes(projectId)),
        swallowApiClientError(projectsApi.mcpConnections(projectId)),
        swallowApiClientError(projectsApi.chainTemplates(projectId)),
        swallowApiClientError(projectsApi.taskTemplates(projectId)),
      ])
      if (modes) setProjectModes(modes)
      if (runtimes) setProjectRuntimes(runtimes)
      if (mcpConnections) setProjectMcpConnections(mcpConnections)
      if (templates) setChainTemplates(templates)
      if (fetchedTaskTemplates) setTaskTemplates(fetchedTaskTemplates)
      const fetchedTriggers = await swallowApiClientError(projectsApi.triggers(projectId))
      if (fetchedTriggers) setTriggers(fetchedTriggers)
      setSettingsSyncedProjectId(projectId)
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
    if (!project) {
      toast({ title: 'Failed to switch project', description: 'The project could not be loaded. Try again.', variant: 'destructive' })
      return
    }
    setCurrentProject(project)
    await fetchActivities(project.id)
    await fetchProjectSettings(project.id)
  }, [fetchProject, fetchActivities, fetchProjectSettings, toast])

  const resetProjectForm = useCallback(() => {
    setProjectName('')
    setProjectDescription('')
    setProjectColor('#3b82f6')
    setCreateStarterAgents(true)
  }, [])

  const handleCreateProject = useCallback(async () => {
    if (!projectName.trim()) return
    try {
      const newProject: ProjectListItem = await projectsApi.create(
        { name: projectName, description: projectDescription, color: projectColor },
        { errorFallback: 'Failed to create project' },
      )
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
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error creating project:', error)
      toast({ title: 'Failed to create project', variant: 'destructive' })
    }
  }, [projectName, projectDescription, projectColor, fetchProject, fetchActivities, fetchProjectSettings, resetProjectForm, toast])

  const handleSeedDemoData = useCallback(async () => {
    setSeedingDemoData(true)
    try {
      await seedApi.run({ errorFallback: 'Failed to load demo data' })
      await initializeBoard()
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error loading demo data:', error)
      toast({ title: 'Failed to load demo data', variant: 'destructive' })
    } finally {
      setSeedingDemoData(false)
    }
  }, [initializeBoard, toast])

  // --- API Key management ---

  const fetchLegacyKeyStatus = useCallback(async () => {
    try {
      setLegacyKeyStatus(await adminApi.legacyKeyStatus({ errorFallback: 'Failed to load API key security status' }))
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error loading API key security status:', error)
      toast({ title: 'Failed to load API key security status', variant: 'destructive' })
    }
  }, [toast])

  const loadApiKeys = useCallback(async (project: Project) => {
    setLoadingApiKeys(true)
    setCopiedKey(null)
    try {
      let projectPayload
      try {
        projectPayload = await projectsApi.key.get(project.id, { errorFallback: 'Failed to load project API key' })
      } catch (error) {
        // API errors on the project key toast without the console noise the
        // outer catch adds (matching the old early-return on !res.ok).
        if (error instanceof ApiClientError) {
          toast({ title: error.message, variant: 'destructive' })
          return
        }
        throw error
      }
      setProjectApiKey(null)
      setProjectApiPreview(projectPayload.preview || null)

      const keyEntries = await Promise.all(
        project.agents.map(async (agent) => {
          const payload = await agentsApi.key.get(agent.id, { errorFallback: `Failed to load API key for ${agent.name}` })
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
  }, [toast])

  const rotateProjectApiKey = useCallback(async () => {
    if (!currentProject) return
    setRotatingKeyId('project')
    try {
      const payload = await projectsApi.key.rotate(currentProject.id, { errorFallback: 'Failed to rotate project API key' })
      setProjectApiKey(payload.apiKey || null)
      setProjectApiPreview(payload.preview || null)
      setCopiedKey((current) => (current === 'project' ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
      } else {
        console.error('Error rotating project API key:', error)
        toast({ title: 'Failed to rotate project API key', variant: 'destructive' })
      }
    } finally {
      setRotatingKeyId(null)
    }
  }, [currentProject, fetchLegacyKeyStatus, toast])

  const rotateAgentApiKey = useCallback(async (agentId: string) => {
    setRotatingKeyId(agentId)
    try {
      const payload = await agentsApi.key.rotate(agentId, { errorFallback: 'Failed to rotate agent API key' })
      setAgentApiKeys((prev) => ({ ...prev, [agentId]: payload.apiKey || '' }))
      setAgentApiPreviews((prev) => ({ ...prev, [agentId]: payload.preview || prev[agentId] || '' }))
      setCopiedKey((current) => (current === agentId ? null : current))
      await fetchLegacyKeyStatus()
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
      } else {
        console.error('Error rotating agent API key:', error)
        toast({ title: 'Failed to rotate agent API key', variant: 'destructive' })
      }
    } finally {
      setRotatingKeyId(null)
    }
  }, [fetchLegacyKeyStatus, toast])

  const migrateLegacyKeys = useCallback(async () => {
    if (!currentProject) return
    setMigratingLegacyKeys(true)
    try {
      await adminApi.migrateLegacyKeys({ errorFallback: 'Failed to migrate legacy API keys' })
      await Promise.all([loadApiKeys(currentProject), fetchLegacyKeyStatus()])
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
      } else {
        console.error('Error migrating legacy API keys:', error)
        toast({ title: 'Failed to migrate legacy API keys', variant: 'destructive' })
      }
    } finally {
      setMigratingLegacyKeys(false)
    }
  }, [currentProject, fetchLegacyKeyStatus, loadApiKeys, toast])

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
    loadError,
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
    taskTemplates,
    setTaskTemplates,
    triggers,
    setTriggers,
    settingsSyncedProjectId,

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
