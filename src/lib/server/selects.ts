export const projectSummarySelect = {
  id: true,
  name: true,
  description: true,
  color: true,
} as const

export const agentSummarySelect = {
  id: true,
  name: true,
  emoji: true,
  color: true,
  description: true,
  isActive: true,
  lastSeen: true,
  invocationMode: true,
} as const

export const taskBoardInclude = {
  agent: {
    select: agentSummarySelect,
  },
  project: {
    select: projectSummarySelect,
  },
  steps: {
    select: {
      id: true,
      order: true,
      mode: true,
      status: true,
      agentId: true,
      humanLabel: true,
      autoContinue: true,
      rejectionNote: true,
      attempts: true,
      agent: { select: { id: true, name: true, emoji: true } },
    },
    orderBy: { order: 'asc' as const },
  },
} as const

export const stepDetailInclude = {
  agent: { select: { id: true, name: true, emoji: true } },
  executions: {
    select: {
      id: true,
      attempt: true,
      status: true,
      output: true,
      error: true,
      tokensUsed: true,
      cost: true,
      durationMs: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: { attempt: 'asc' as const },
  },
} as const
