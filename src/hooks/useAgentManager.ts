'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { ApiClientError } from '@/lib/api/client'
import { agentsApi } from '@/lib/api/endpoints'
import type { Agent, Project } from '@/types/board'

interface UseAgentManagerParams {
  setCurrentProject: React.Dispatch<React.SetStateAction<Project | null>>
}

type ToastFn = (opts: { title: string; description?: string; variant?: 'destructive' | 'default' }) => void

/**
 * D-4: pause/resume an agent by flipping `isActive` via PUT /api/agents/[id].
 * A paused agent is skipped by the dispatcher (see step-queue.ts), so this is
 * how an operator stops an agent claiming work without deleting it.
 *
 * Optimistic: flips the local copy immediately, reconciles with the server's
 * authoritative `isActive`, and rolls back + toasts on failure — mirroring
 * useTaskManager.moveTaskToStatus. Kept as a free function (not part of the
 * hook's returned handlers) so both the sidebar list and the settings list can
 * call it directly with their own context-sourced setCurrentProject + toast,
 * without threading a new value through the board context providers.
 */
export async function toggleAgentActive(
  agent: Pick<Agent, 'id' | 'name' | 'isActive'>,
  deps: {
    setCurrentProject: React.Dispatch<React.SetStateAction<Project | null>>
    toast: ToastFn
  },
): Promise<void> {
  const { setCurrentProject, toast } = deps
  const next = !agent.isActive

  const applyActive = (isActive: boolean) => setCurrentProject(prev => prev ? {
    ...prev,
    agents: prev.agents.map(a => a.id === agent.id ? { ...a, isActive } : a),
  } : null)

  applyActive(next) // optimistic

  try {
    const updated = await agentsApi.update(agent.id, { isActive: next }, { errorFallback: 'Failed to update agent' })
    applyActive(updated.isActive) // reconcile with the authoritative value
    toast({ title: next ? `${agent.name} resumed` : `${agent.name} paused` })
  } catch (error) {
    applyActive(agent.isActive) // rollback
    if (error instanceof ApiClientError) {
      toast({ title: error.message, variant: 'destructive' })
      return
    }
    console.error('Error toggling agent:', error)
    toast({ title: 'Failed to update agent', variant: 'destructive' })
  }
}

export function useAgentManager({ setCurrentProject }: UseAgentManagerParams) {
  const { toast } = useToast()

  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [expandedAgentStats, setExpandedAgentStats] = useState<string | null>(null)

  const openEditAgentDialog = useCallback(async (agent: Agent) => {
    // Board-level agent objects come from taskBoardInclude's summary select
    // (missing maxConcurrent, invocationMode, capabilities, supportedModes,
    // modeInstructions, runtimeModel, systemPrompt, mcpConnectionIds).
    // Fetch the full record so the edit form doesn't silently overwrite them.
    setAgentDialogOpen(true)
    try {
      setEditingAgent(await agentsApi.get(agent.id))
    } catch {
      // Any failure (API error or network) falls back to the summary object.
      setEditingAgent(agent)
    }
  }, [])

  const resetAgentForm = useCallback(() => {
    setEditingAgent(null)
  }, [])

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    // Deletion is permanent and wipes the agent's API key — confirm first.
    if (!window.confirm('Delete this agent? This is permanent and invalidates its API key.')) return
    try {
      await agentsApi.delete(agentId, { errorFallback: 'Failed to delete agent' })
      setCurrentProject(prev => prev ? {
        ...prev,
        agents: prev.agents.filter(a => a.id !== agentId),
      } : null)
    } catch (error) {
      if (error instanceof ApiClientError) {
        toast({ title: error.message, variant: 'destructive' })
        return
      }
      console.error('Error deleting agent:', error)
      toast({ title: 'Failed to delete agent', variant: 'destructive' })
    }
  }, [setCurrentProject, toast])

  return {
    editingAgent,
    setEditingAgent,
    agentDialogOpen,
    setAgentDialogOpen,
    wizardOpen,
    setWizardOpen,
    expandedAgentStats,
    setExpandedAgentStats,
    openEditAgentDialog,
    resetAgentForm,
    handleDeleteAgent,
  }
}
