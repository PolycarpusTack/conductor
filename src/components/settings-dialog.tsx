'use client'

import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsModes } from '@/components/settings-modes'
import { SettingsRuntimes } from '@/components/settings-runtimes'
import { SettingsMcp } from '@/components/settings-mcp'
import { SettingsTemplates } from '@/components/settings-templates'
import { SettingsTaskTemplates } from '@/components/settings-task-templates'
import { ObservabilityDashboard } from '@/components/observability-dashboard'
import { SettingsAutomation } from '@/components/settings-automation'
import { SettingsIntegrations } from '@/components/settings-integrations'
import { SettingsActivity } from '@/components/settings-activity'
import { SettingsScopedKeys } from '@/components/settings-scoped-keys'
import { SettingsSecurity } from '@/components/settings-security'
import { AgentActivityDashboard } from '@/components/agent-activity-dashboard'
import {
  Activity,
  Check,
  Copy,
  CopyPlus,
  ExternalLink,
  Key,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Project, TaskStatus, Agent } from '@/types/board'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate, TaskTemplate } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'

type SettingsTabType = 'general' | 'agents' | 'api' | 'security' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null

interface SettingsDialogProps {
  settingsTab: SettingsTabType
  setSettingsTab: (tab: SettingsTabType) => void
  currentProject: Project | null
  getTasksByStatus: (status: TaskStatus) => { id: string }[]
  statusColumns: { id: TaskStatus; label: string; color: string }[]
  projectModes: ProjectMode[]
  setProjectModes: Dispatch<SetStateAction<ProjectMode[]>>
  projectRuntimes: ProjectRuntime[]
  setProjectRuntimes: Dispatch<SetStateAction<ProjectRuntime[]>>
  projectMcpConnections: ProjectMcpConnection[]
  setProjectMcpConnections: Dispatch<SetStateAction<ProjectMcpConnection[]>>
  chainTemplates: ChainTemplate[]
  setChainTemplates: Dispatch<SetStateAction<ChainTemplate[]>>
  taskTemplates: TaskTemplate[]
  setTaskTemplates: Dispatch<SetStateAction<TaskTemplate[]>>
  triggers: IntegrationTrigger[]
  setTriggers: Dispatch<SetStateAction<IntegrationTrigger[]>>
  projectApiKey: string | null
  projectApiPreview: string | null
  agentApiKeys: Record<string, string>
  agentApiPreviews: Record<string, string>
  loadingApiKeys: boolean
  rotatingKeyId: string | null
  legacyKeyStatus: { projectsWithPlaintext: number; agentsWithPlaintext: number; totalWithPlaintext: number } | null
  migratingLegacyKeys: boolean
  copiedKey: string | null
  copyToClipboard: (text: string, key: string) => Promise<void>
  rotateProjectApiKey: () => Promise<void>
  rotateAgentApiKey: (agentId: string) => Promise<void>
  migrateLegacyKeys: () => Promise<void>
  expandedAgentStats: string | null
  setExpandedAgentStats: Dispatch<SetStateAction<string | null>>
  openEditAgentDialog: (agent: Agent) => Promise<void>
  handleDeleteAgent: (id: string) => Promise<void>
  resetAgentForm: () => void
  setAgentDialogOpen: Dispatch<SetStateAction<boolean>>
  onProjectUpdated: (patch: Partial<Project>) => void
  onProjectDeleted: () => void
}

const ARTIFACT_RETENTION_OPTIONS = [
  { value: 'forever', label: 'Keep forever' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
]

/** Editable project basics, defaults, retention, and danger zone (Epic S1). */
function GeneralTab({
  project,
  modes,
  templates,
  onProjectUpdated,
  onProjectDeleted,
  children,
}: {
  project: Project
  modes: ProjectMode[]
  templates: ChainTemplate[]
  onProjectUpdated: (patch: Partial<Project>) => void
  onProjectDeleted: () => void
  children: React.ReactNode
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [defaultStepMode, setDefaultStepMode] = useState(project.defaultStepMode ?? 'none')
  const [defaultChainTemplateId, setDefaultChainTemplateId] = useState(project.defaultChainTemplateId ?? 'none')
  const [artifactRetention, setArtifactRetention] = useState(
    project.artifactRetentionDays ? String(project.artifactRetentionDays) : 'forever',
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Re-sync when switching projects while the dialog is open
  useEffect(() => {
    setName(project.name)
    setDescription(project.description ?? '')
    setDefaultStepMode(project.defaultStepMode ?? 'none')
    setDefaultChainTemplateId(project.defaultChainTemplateId ?? 'none')
    setArtifactRetention(project.artifactRetentionDays ? String(project.artifactRetentionDays) : 'forever')
    setStatus('idle')
    setDeleteConfirm('')
  }, [project.id, project.name, project.description, project.defaultStepMode, project.defaultChainTemplateId, project.artifactRetentionDays])

  const patch = {
    name: name.trim(),
    description: description.trim() || null,
    defaultStepMode: defaultStepMode === 'none' ? null : defaultStepMode,
    defaultChainTemplateId: defaultChainTemplateId === 'none' ? null : defaultChainTemplateId,
    artifactRetentionDays: artifactRetention === 'forever' ? null : parseInt(artifactRetention, 10),
  }

  const dirty =
    patch.name !== project.name ||
    patch.description !== (project.description ?? null) ||
    patch.defaultStepMode !== (project.defaultStepMode ?? null) ||
    patch.defaultChainTemplateId !== (project.defaultChainTemplateId ?? null) ||
    patch.artifactRetentionDays !== (project.artifactRetentionDays ?? null)

  const save = async () => {
    if (!patch.name) return
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      onProjectUpdated(patch)
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const deleteProject = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (res.ok) onProjectDeleted()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <label htmlFor="settings-project-name" className="text-sm font-medium">Project Name</label>
        <Input id="settings-project-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <label htmlFor="settings-project-description" className="text-sm font-medium">Description</label>
        <Textarea
          id="settings-project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>

      <div className="rounded-lg border border-border/30 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Task Defaults</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Applied when creating new tasks. The default mode dispatches agent-assigned tasks without steps;
            the default chain prefills the step builder.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="settings-default-mode" className="text-xs font-medium">Default step mode</label>
            <Select value={defaultStepMode} onValueChange={setDefaultStepMode}>
              <SelectTrigger id="settings-default-mode" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">develop (built-in default)</SelectItem>
                {modes.map((m) => (
                  <SelectItem key={m.id} value={m.name} className="text-xs">{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="settings-default-chain" className="text-xs font-medium">Default chain template</label>
            <Select value={defaultChainTemplateId} onValueChange={setDefaultChainTemplateId}>
              <SelectTrigger id="settings-default-chain" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">{t.icon} {t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="settings-artifact-retention" className="text-xs font-medium">Artifact retention (DONE tasks)</label>
          <Select value={artifactRetention} onValueChange={setArtifactRetention}>
            <SelectTrigger id="settings-artifact-retention" className="h-8 text-xs w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTIFACT_RETENTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || !dirty || !patch.name}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {status === 'saved' && !dirty && <span className="text-xs text-emerald-400">Saved.</span>}
        {status === 'error' && <span className="text-xs text-[var(--op-red,#F87171)]">Failed to save — try again.</span>}
      </div>

      {children}

      <div className="rounded-lg border border-[var(--op-red-dim,rgba(248,113,113,0.2))] bg-[var(--op-red-bg,rgba(248,113,113,0.05))] p-4 space-y-2">
        <p className="text-sm font-medium text-[var(--op-red,#F87171)]">Danger Zone</p>
        <p className="text-xs text-muted-foreground">
          Deleting a project removes its agents, tasks, steps, artifacts, and history. This cannot be undone.
          Type <strong className="text-foreground">{project.name}</strong> to confirm.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={project.name}
            className="h-8 text-xs flex-1"
            aria-label="Type the project name to confirm deletion"
          />
          <Button
            variant="destructive"
            size="sm"
            className="h-8 text-xs"
            disabled={deleteConfirm !== project.name || deleting}
            onClick={deleteProject}
          >
            {deleting ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function SettingsDialog({
  settingsTab, setSettingsTab,
  currentProject, getTasksByStatus, statusColumns,
  projectModes, setProjectModes,
  projectRuntimes, setProjectRuntimes,
  projectMcpConnections, setProjectMcpConnections,
  chainTemplates, setChainTemplates, taskTemplates, setTaskTemplates,
  triggers, setTriggers,
  projectApiKey, projectApiPreview, agentApiKeys, agentApiPreviews,
  loadingApiKeys, rotatingKeyId, legacyKeyStatus, migratingLegacyKeys, copiedKey,
  copyToClipboard, rotateProjectApiKey, rotateAgentApiKey, migrateLegacyKeys,
  expandedAgentStats, setExpandedAgentStats,
  openEditAgentDialog, handleDeleteAgent, resetAgentForm, setAgentDialogOpen,
  onProjectUpdated, onProjectDeleted,
}: SettingsDialogProps) {
  const handleDuplicateAgent = async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}/duplicate`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) return
      // Surface the once-shown key; prompt doubles as a copy affordance
      window.prompt(
        'Agent duplicated (inactive). Copy its API key now — it will not be shown again:',
        data.rawKey,
      )
      if (currentProject) {
        onProjectUpdated({ agents: [...currentProject.agents, data.agent] })
      }
    } catch {
      // toast-less panel — failures leave the list unchanged
    }
  }

  return (
    <Dialog open={settingsTab !== null} onOpenChange={(open) => !open && setSettingsTab(null)}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={settingsTab || 'general'} onValueChange={(v) => setSettingsTab(v as NonNullable<SettingsTabType>)}>
          <TabsList className="flex flex-wrap gap-1 w-full">
            <TabsTrigger value="general" className="text-xs">General</TabsTrigger>
            <TabsTrigger value="agents" className="text-xs">Agents</TabsTrigger>
            <TabsTrigger value="api" className="text-xs">API Keys</TabsTrigger>
            <TabsTrigger value="security" className="text-xs">Security</TabsTrigger>
            <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
            <TabsTrigger value="modes" className="text-xs">Modes</TabsTrigger>
            <TabsTrigger value="runtimes" className="text-xs">Runtimes</TabsTrigger>
            <TabsTrigger value="mcp" className="text-xs">MCP</TabsTrigger>
            <TabsTrigger value="templates" className="text-xs">Templates</TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs">Analytics</TabsTrigger>
            <TabsTrigger value="automation" className="text-xs">Automation</TabsTrigger>
            <TabsTrigger value="integrations" className="text-xs">Integrations</TabsTrigger>
          </TabsList>

          <div className="mt-4 overflow-y-auto max-h-[50vh]">
            <TabsContent value="general" className="mt-0">
              {currentProject && (
                <GeneralTab
                  key={currentProject.id}
                  project={currentProject}
                  modes={projectModes}
                  templates={chainTemplates}
                  onProjectUpdated={onProjectUpdated}
                  onProjectDeleted={onProjectDeleted}
                >
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Tasks Summary</span>
                    <div className="grid grid-cols-5 gap-2 text-center">
                      {statusColumns.map((col) => (
                        <div key={col.id} className="rounded-lg bg-muted/30 p-2">
                          <div className="text-lg font-bold">{getTasksByStatus(col.id).length}</div>
                          <div className="text-[10px] text-muted-foreground">{col.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </GeneralTab>
              )}
            </TabsContent>

            <TabsContent value="agents" className="mt-0">
              <div className="space-y-3">
                {projectRuntimes.length === 0 && (
                  <div className="rounded-lg border border-[var(--op-amber-dim)] bg-[var(--op-amber-bg)] p-4">
                    <div className="flex items-start gap-3">
                      <div className="text-[var(--op-amber)] mt-0.5">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[var(--op-amber)] mb-1">Add a runtime first</div>
                        <p className="text-xs text-foreground/75 leading-relaxed mb-3">
                          Agents need a runtime (an AI provider like Anthropic or OpenAI, plus an API key)
                          before they can run. Without one, agents you create will be silently skipped
                          by the dispatcher.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs border-[var(--op-amber-dim)] hover:bg-[var(--op-amber)]/10"
                          onClick={() => setSettingsTab('runtimes')}
                        >
                          Go to Runtimes →
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
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
                        <Button variant="ghost" size="sm" title="Duplicate agent" onClick={() => handleDuplicateAgent(agent.id)}>
                          <CopyPlus className="h-3 w-3" />
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

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { resetAgentForm(); setAgentDialogOpen(true) }}
                  disabled={projectRuntimes.length === 0}
                  title={projectRuntimes.length === 0 ? 'Add a runtime first — agents need one to dispatch' : undefined}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Agent
                </Button>
              </div>
            </TabsContent>

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

                <SettingsScopedKeys />

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

            <TabsContent value="security" className="mt-0">
              <SettingsSecurity />
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              {currentProject && <SettingsActivity projectId={currentProject.id} />}
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
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Chain templates</h3>
                    <p className="text-xs text-muted-foreground mb-3">Reusable multi-step workflows for the chain builder.</p>
                    <SettingsTemplates
                      projectId={currentProject.id}
                      templates={chainTemplates}
                      modes={projectModes}
                      onTemplatesChange={setChainTemplates}
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Task templates</h3>
                    <p className="text-xs text-muted-foreground mb-3">Saved task-form defaults — pick one in the create-task dialog to prefill title, priority, tag, notes, and an attached chain.</p>
                    <SettingsTaskTemplates
                      projectId={currentProject.id}
                      templates={taskTemplates}
                      chainTemplates={chainTemplates}
                      onTemplatesChange={setTaskTemplates}
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-0">
              {currentProject && <ObservabilityDashboard projectId={currentProject.id} />}
            </TabsContent>

            <TabsContent value="automation" className="mt-0">
              {currentProject && <SettingsAutomation projectId={currentProject.id} />}
            </TabsContent>

            <TabsContent value="integrations" className="mt-0">
              {currentProject && (
                <SettingsIntegrations
                  projectId={currentProject.id}
                  triggers={triggers}
                  onTriggersChange={setTriggers}
                />
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
