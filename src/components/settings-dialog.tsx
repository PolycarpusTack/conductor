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
import { SettingsModes } from '@/components/settings-modes'
import { SettingsRuntimes } from '@/components/settings-runtimes'
import { SettingsMcp } from '@/components/settings-mcp'
import { SettingsTemplates } from '@/components/settings-templates'
import { ObservabilityDashboard } from '@/components/observability-dashboard'
import { SettingsAutomation } from '@/components/settings-automation'
import { SettingsIntegrations } from '@/components/settings-integrations'
import { SettingsActivity } from '@/components/settings-activity'
import { SettingsScopedKeys } from '@/components/settings-scoped-keys'
import { AgentActivityDashboard } from '@/components/agent-activity-dashboard'
import {
  Activity,
  Check,
  Copy,
  ExternalLink,
  Key,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Project, TaskStatus, Agent } from '@/types/board'
import type { ProjectMode, ProjectRuntime, ProjectMcpConnection, ChainTemplate } from '@/types/settings'
import type { IntegrationTrigger } from '@/components/settings-integrations'

type SettingsTabType = 'general' | 'agents' | 'api' | 'activity' | 'modes' | 'runtimes' | 'mcp' | 'templates' | 'analytics' | 'automation' | 'integrations' | null

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
  onProjectUpdated: (patch: { name: string; description: string | null }) => void
}

/** Editable project basics — saves through PUT /api/projects/[id]. */
function GeneralTab({
  project,
  onProjectUpdated,
  children,
}: {
  project: Project
  onProjectUpdated: (patch: { name: string; description: string | null }) => void
  children: React.ReactNode
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  // Re-sync when switching projects while the dialog is open
  useEffect(() => {
    setName(project.name)
    setDescription(project.description ?? '')
    setStatus('idle')
  }, [project.id, project.name, project.description])

  const dirty = name !== project.name || description !== (project.description ?? '')

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    setStatus('idle')
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      onProjectUpdated({ name: name.trim(), description: description.trim() || null })
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
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
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || !dirty || !name.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {status === 'saved' && !dirty && <span className="text-xs text-emerald-400">Saved.</span>}
        {status === 'error' && <span className="text-xs text-[var(--op-red,#F87171)]">Failed to save — try again.</span>}
      </div>
      {children}
    </div>
  )
}

export function SettingsDialog({
  settingsTab, setSettingsTab,
  currentProject, getTasksByStatus, statusColumns,
  projectModes, setProjectModes,
  projectRuntimes, setProjectRuntimes,
  projectMcpConnections, setProjectMcpConnections,
  chainTemplates, setChainTemplates,
  triggers, setTriggers,
  projectApiKey, projectApiPreview, agentApiKeys, agentApiPreviews,
  loadingApiKeys, rotatingKeyId, legacyKeyStatus, migratingLegacyKeys, copiedKey,
  copyToClipboard, rotateProjectApiKey, rotateAgentApiKey, migrateLegacyKeys,
  expandedAgentStats, setExpandedAgentStats,
  openEditAgentDialog, handleDeleteAgent, resetAgentForm, setAgentDialogOpen,
  onProjectUpdated,
}: SettingsDialogProps) {
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
                <GeneralTab key={currentProject.id} project={currentProject} onProjectUpdated={onProjectUpdated}>
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
                <SettingsTemplates
                  projectId={currentProject.id}
                  templates={chainTemplates}
                  modes={projectModes}
                  onTemplatesChange={setChainTemplates}
                />
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
