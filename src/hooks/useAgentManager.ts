'use client'

import { useState, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'
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

  const readApiError = useCallback(async (response: Response, fallback: string) => {
    try {
      const payload = await response.json()
      return payload?.error || fallback
    } catch {
      return fallback
    }
  }, [])

  const openEditAgentDialog = useCallback(async (agent: Agent) => {
    // Board-level agent objects come from taskBoardInclude's summary select
    // (missing maxConcurrent, invocationMode, capabilities, supportedModes,
    // modeInstructions, runtimeModel, systemPrompt, mcpConnectionIds).
    // Fetch the full record so the edit form doesn't silently overwrite them.
    setAgentDialogOpen(true)
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { cache: 'no-store' })
      if (res.ok) {
        setEditingAgent(await res.json())
      } else {
        setEditingAgent(agent)
      }
    } catch {
      setEditingAgent(agent)
    }
  }, [])

  const resetAgentForm = useCallback(() => {
    setEditingAgent(null)
  }, [])

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
      if (!res.ok) {
        toast({ title: await readApiError(res, 'Failed to delete agent'), variant: 'destructive' })
        return
      }
      setCurrentProject(prev => prev ? {
        ...prev,
        agents: prev.agents.filter(a => a.id !== agentId),
      } : null)
    } catch (error) {
      console.error('Error deleting agent:', error)
      toast({ title: 'Failed to delete agent', variant: 'destructive' })
    }
  }, [setCurrentProject, readApiError, toast])

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
