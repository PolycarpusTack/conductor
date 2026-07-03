'use client'

import { useEffect, useState } from 'react'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { SettingsUsers } from '@/components/settings-users'
import { SettingsAgents } from '@/components/settings-agents'
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
import type { Project } from '@/types/board'
import type { ProjectMode, ChainTemplate } from '@/types/settings'
import { useProjectDataCtx, useAgentActions, useUiState } from '@/app/_views/board-context'
import type { SettingsTabType } from '@/app/_views/board-context'
import { statusColumns } from '@/app/_views/board-constants'

type SettingsTab = NonNullable<SettingsTabType>

/**
 * Grouped information architecture for the settings surface (story E-6).
 * Tab values are unchanged — they are the public deep-link contract
 * (SettingsTabType in board-context.tsx); only their presentation is grouped.
 */
const SETTINGS_NAV: ReadonlyArray<{
  group: string
  tabs: ReadonlyArray<{ value: SettingsTab; label: string }>
}> = [
  {
    group: 'Project',
    tabs: [
      { value: 'general', label: 'General' },
      { value: 'templates', label: 'Templates' },
      { value: 'modes', label: 'Modes' },
    ],
  },
  {
    group: 'Execution',
    tabs: [
      { value: 'agents', label: 'Agents' },
      { value: 'runtimes', label: 'Runtimes' },
      { value: 'mcp', label: 'MCP' },
      { value: 'automation', label: 'Automation' },
    ],
  },
  {
    group: 'Observe',
    tabs: [
      { value: 'activity', label: 'Activity' },
      { value: 'analytics', label: 'Analytics' },
    ],
  },
  {
    group: 'Access & Integrations',
    tabs: [
      { value: 'api', label: 'API Keys' },
      { value: 'security', label: 'Security' },
      { value: 'integrations', label: 'Integrations' },
    ],
  },
]

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
  const [budgetInput, setBudgetInput] = useState(
    project.budgetUsd != null ? String(project.budgetUsd) : '',
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
    setBudgetInput(project.budgetUsd != null ? String(project.budgetUsd) : '')
    setStatus('idle')
    setDeleteConfirm('')
  }, [project.id, project.name, project.description, project.defaultStepMode, project.defaultChainTemplateId, project.artifactRetentionDays, project.budgetUsd])

  // Blank = no budget (null clears it server-side).
  const parsedBudget = budgetInput.trim() === '' ? null : Number(budgetInput)
  const budgetInvalid = parsedBudget !== null && (!Number.isFinite(parsedBudget) || parsedBudget < 0)

  const patch = {
    name: name.trim(),
    description: description.trim() || null,
    defaultStepMode: defaultStepMode === 'none' ? null : defaultStepMode,
    defaultChainTemplateId: defaultChainTemplateId === 'none' ? null : defaultChainTemplateId,
    artifactRetentionDays: artifactRetention === 'forever' ? null : parseInt(artifactRetention, 10),
    budgetUsd: budgetInvalid ? null : parsedBudget,
  }

  const dirty =
    patch.name !== project.name ||
    patch.description !== (project.description ?? null) ||
    patch.defaultStepMode !== (project.defaultStepMode ?? null) ||
    patch.defaultChainTemplateId !== (project.defaultChainTemplateId ?? null) ||
    patch.artifactRetentionDays !== (project.artifactRetentionDays ?? null) ||
    patch.budgetUsd !== (project.budgetUsd ?? null)

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

      <div className="rounded-lg border border-border/30 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium">Spend Budget</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monthly cap on recorded agent spend (USD, UTC calendar month). When month-to-date
            cost reaches the budget, dispatch pauses until the budget is raised. Blank = no budget.
          </p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="settings-budget-usd" className="text-xs font-medium">Monthly budget (USD)</label>
          <Input
            id="settings-budget-usd"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="No budget"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className="h-8 text-xs w-48"
          />
          {budgetInvalid && (
            <p className="text-xs text-[var(--op-red)]">Budget must be zero or a positive amount.</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || !dirty || !patch.name || budgetInvalid}>
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

export function SettingsDialog() {
  const {
    projects,
    currentProject, setCurrentProject,
    getTasksByStatus,
    projectModes, setProjectModes,
    projectRuntimes, setProjectRuntimes,
    projectMcpConnections, setProjectMcpConnections,
    chainTemplates, setChainTemplates, taskTemplates, setTaskTemplates,
    triggers, setTriggers,
    projectApiKey, projectApiPreview, agentApiKeys, agentApiPreviews,
    loadingApiKeys, rotatingKeyId, legacyKeyStatus, migratingLegacyKeys, copiedKey,
    copyToClipboard, rotateProjectApiKey, rotateAgentApiKey, migrateLegacyKeys,
    switchProject,
  } = useProjectDataCtx()
  const { openEditAgentDialog, handleDeleteAgent, resetAgentForm, setAgentDialogOpen } = useAgentActions()
  const { settingsTab, setSettingsTab } = useUiState()

  // Callbacks formerly injected by BoardView — same logic, now sourced from context.
  const onProjectUpdated = (patch: Partial<Project>) =>
    setCurrentProject(prev => (prev ? { ...prev, ...patch } : prev))

  const onLibraryImported = () => {
    if (currentProject) void switchProject(currentProject.id)
  }

  const onProjectDeleted = () => {
    setSettingsTab(null)
    const survivor = projects.find(p => p.id !== currentProject?.id)
    if (survivor) {
      switchProject(survivor.id)
    } else {
      setCurrentProject(null)
    }
  }

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

  const activeTab: SettingsTab = settingsTab ?? 'general'

  return (
    <Dialog open={settingsTab !== null} onOpenChange={(open) => !open && setSettingsTab(null)}>
      <DialogContent className="sm:max-w-[800px] h-[80vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 sm:flex-row">
          {/* Below sm the grouped nav collapses into a select. */}
          <div className="sm:hidden">
            <Select value={activeTab} onValueChange={(v) => setSettingsTab(v as SettingsTab)}>
              <SelectTrigger className="w-full" aria-label="Settings section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTINGS_NAV.map((group) => (
                  <SelectGroup key={group.group}>
                    <SelectLabel>{group.group}</SelectLabel>
                    {group.tabs.map((tab) => (
                      <SelectItem key={tab.value} value={tab.value}>{tab.label}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <nav
            aria-label="Settings sections"
            className="hidden w-44 shrink-0 overflow-y-auto border-r border-border/30 pr-3 sm:block"
          >
            {SETTINGS_NAV.map((group, groupIndex) => (
              <div key={group.group} className={groupIndex > 0 ? 'mt-4' : undefined}>
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.group}
                </p>
                <ul className="space-y-0.5">
                  {group.tabs.map((tab) => {
                    const active = activeTab === tab.value
                    return (
                      <li key={tab.value}>
                        <button
                          type="button"
                          onClick={() => setSettingsTab(tab.value)}
                          aria-current={active ? 'page' : undefined}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                            active
                              ? 'bg-muted font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          }`}
                        >
                          {tab.label}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto sm:pr-1">
            {activeTab === 'general' && currentProject && (
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

            {activeTab === 'agents' && (
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
                {currentProject && (
                  <SettingsAgents
                    projectId={currentProject.id}
                    agents={currentProject.agents}
                    hasRuntimes={projectRuntimes.length > 0}
                    onAddAgent={() => { resetAgentForm(); setAgentDialogOpen(true) }}
                    onEditAgent={openEditAgentDialog}
                    onDeleteAgent={handleDeleteAgent}
                    onDuplicateAgent={handleDuplicateAgent}
                    onImported={onLibraryImported}
                  />
                )}
              </div>
            )}

            {activeTab === 'api' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/30 p-4">
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Key className="h-4 w-4" />
                    Project API Key
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">Loaded on demand and managed separately from general project data. Raw keys are shown only immediately after rotation.</p>
                  <div className="flex items-center gap-2">
                    {loadingApiKeys ? (
                      <div className="flex-1 bg-muted/30 px-3 py-2 rounded">
                        <Skeleton className="h-4 w-48 max-w-full" />
                      </div>
                    ) : (
                    <code className="flex-1 text-xs bg-muted/30 px-3 py-2 rounded font-mono">
                      {projectApiKey || projectApiPreview || 'Rotate to generate a new key'}
                    </code>
                    )}
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
                        {loadingApiKeys ? (
                          <Skeleton className="h-4 flex-1" />
                        ) : (
                        <span className="text-xs flex-1 font-mono truncate">
                          {agentApiKeys[agent.id] || agentApiPreviews[agent.id] || 'Rotate to generate a new key'}
                        </span>
                        )}
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
            )}

            {activeTab === 'security' && (
              <div className="space-y-6">
                <SettingsUsers />
                <SettingsSecurity />
              </div>
            )}

            {activeTab === 'activity' && currentProject && (
              <SettingsActivity projectId={currentProject.id} />
            )}

            {activeTab === 'modes' && currentProject && (
              <SettingsModes
                projectId={currentProject.id}
                modes={projectModes}
                onModesChange={setProjectModes}
              />
            )}

            {activeTab === 'runtimes' && currentProject && (
              <SettingsRuntimes
                projectId={currentProject.id}
                runtimes={projectRuntimes}
                onRuntimesChange={setProjectRuntimes}
              />
            )}

            {activeTab === 'mcp' && currentProject && (
              <SettingsMcp
                projectId={currentProject.id}
                connections={projectMcpConnections}
                onConnectionsChange={setProjectMcpConnections}
              />
            )}

            {activeTab === 'templates' && currentProject && (
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

            {activeTab === 'analytics' && currentProject && (
              <ObservabilityDashboard projectId={currentProject.id} />
            )}

            {activeTab === 'automation' && currentProject && (
              <SettingsAutomation projectId={currentProject.id} />
            )}

            {activeTab === 'integrations' && currentProject && (
              <SettingsIntegrations
                projectId={currentProject.id}
                triggers={triggers}
                onTriggersChange={setTriggers}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
