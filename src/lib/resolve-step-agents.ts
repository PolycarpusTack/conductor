// Library chain templates reference agents by role (Agent.role = library
// slug). When loading template steps into the chain builder, resolve each
// role to the project's matching agent so the assignment is visible and
// editable — the server repeats the resolution at creation as a safety net.

export function resolveStepAgents<T extends { agentId?: string | null; agentRole?: string }>(
  steps: T[],
  agents: Array<{ id: string; role?: string | null }>,
): T[] {
  return steps.map((step) => {
    if (step.agentId || !step.agentRole) return step
    const match = agents.find((a) => a.role === step.agentRole)
    return match ? { ...step, agentId: match.id } : step
  })
}
