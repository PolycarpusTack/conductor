export interface StepCondition {
  field: 'output' | 'status' | 'tokensUsed' | 'error'
  operator: 'contains' | 'not_contains' | 'equals' | 'gt' | 'lt' | 'matches'
  value: string
}

export interface StepContext {
  output?: string | null
  status: string
  tokensUsed?: number | null
  error?: string | null
}

export function evaluateCondition(condition: StepCondition, context: StepContext): boolean {
  const fieldValue = context[condition.field]
  const strValue = String(fieldValue ?? '')

  switch (condition.operator) {
    case 'contains':
      return strValue.toLowerCase().includes(condition.value.toLowerCase())
    case 'not_contains':
      return !strValue.toLowerCase().includes(condition.value.toLowerCase())
    case 'equals':
      return strValue === condition.value
    case 'gt':
      return Number(fieldValue) > Number(condition.value)
    case 'lt':
      return Number(fieldValue) < Number(condition.value)
    case 'matches': {
      const pattern = condition.value
      // Guard 1: reject patterns longer than 200 characters
      if (pattern.length > 200) return false
      // Guard 2: reject patterns containing nested quantifiers (ReDoS heuristic)
      if (/(\+|\*|\{[^}]*,\s*\})\s*[+*{]/.test(pattern)) return false
      // Guard 3: truncate input to at most 1000 characters
      const safeInput = strValue.length > 1000 ? strValue.slice(0, 1000) : strValue
      try { return new RegExp(pattern, 'i').test(safeInput) }
      catch { return false }
    }
    default:
      return false
  }
}

export interface StepEdge {
  targetStepId: string
  condition?: StepCondition
  label?: string
}

/**
 * Evaluate which edges should be taken from a completed step.
 * Returns all matching target step IDs.
 * If no conditional edges match, returns unconditional edges (those without conditions).
 */
export function resolveNextSteps(edges: StepEdge[], context: StepContext): string[] {
  const conditionalEdges = edges.filter(e => e.condition)
  const unconditionalEdges = edges.filter(e => !e.condition)

  // Evaluate conditional edges
  const matchingConditional = conditionalEdges
    .filter(e => evaluateCondition(e.condition!, context))
    .map(e => e.targetStepId)

  // If any conditional edges match, use those
  if (matchingConditional.length > 0) {
    return matchingConditional
  }

  // Otherwise fall back to unconditional edges (default paths)
  return unconditionalEdges.map(e => e.targetStepId)
}
