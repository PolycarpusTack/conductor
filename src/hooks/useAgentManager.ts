'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
import { ApiClientError } from '@/lib/api/client'
import { agentsApi } from '@/lib/api/endpoints'
import type { Agent, Project } from '@/types/board'

interface UseAgentManagerParams {
  setCurrentProject: React.Dispatch<React.SetStateAction<Project | null>>
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
