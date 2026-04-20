import { db } from '@/lib/db'
import { type StepEdge } from '@/lib/server/condition-evaluator'
import { safeJsonParse } from '@/lib/server/utils'

// =============================================================================
// DAG edge operations for workflow steps.
//
// Extracted from dispatch.ts so dispatch.ts can focus on the step-execution
// path while chain-state-machine functions (advanceChain, rewindChain,
// startChain) stay separate. `hasDagEdges` is shared with those chain
// functions via export.
// =============================================================================

/** Check if any step has DAG edges (nextSteps or prevSteps). */
export function hasDagEdges(
  steps: Array<{ nextSteps?: string | null; prevSteps?: string | null }>,
): boolean {
  return steps.some((s) => s.nextSteps || s.prevSteps)
}

/**
 * Find the previous agent step for a given step, DAG-aware.
 * In DAG mode: walks prevSteps edges to find the nearest non-human ancestor.
 * In linear mode: finds the highest-order non-human step before this one.
 */
export async function findPreviousAgentStep(taskId: string, stepId: string) {
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    select: { id: true, order: true, mode: true, prevSteps: true, nextSteps: true, agentId: true },
    orderBy: { order: 'asc' },
  })

  const currentStep = allSteps.find((s) => s.id === stepId)
  if (!currentStep) return null

  const isDag = hasDagEdges(allSteps)

  if (isDag) {
    // BFS backward through prevSteps to find the nearest agent step
    const prevIds: string[] = safeJsonParse(currentStep.prevSteps, [])
    const visited = new Set<string>()
    const queue = [...prevIds]

    while (queue.length > 0) {
      const candidateId = queue.shift()!
      if (visited.has(candidateId)) continue
      visited.add(candidateId)

      const candidate = allSteps.find((s) => s.id === candidateId)
      if (!candidate) continue

      if (candidate.mode !== 'human' && candidate.agentId) {
        return candidate
      }

      // Keep walking backward
      const ancestorIds: string[] = safeJsonParse(candidate.prevSteps, [])
      for (const aid of ancestorIds) {
        if (!visited.has(aid)) queue.push(aid)
      }
    }

    return null
  }

  // Linear mode: find highest-order non-human step before this one
  return (
    allSteps
      .filter((s) => s.order < currentStep.order && s.mode !== 'human')
      .sort((a, b) => b.order - a.order)[0] || null
  )
}

/**
 * Normalize DAG edge symmetry for a task's steps.
 * Ensures that for every prevSteps entry there's a corresponding nextSteps entry
 * (and vice versa), so runtime advancement can walk the graph in either direction.
 */
export async function normalizeDagEdges(taskId: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    select: { id: true, nextSteps: true, prevSteps: true },
  })

  if (!hasDagEdges(steps)) return

  // Build current edge maps
  const nextMap = new Map<string, Map<string, StepEdge>>() // stepId -> targetId -> edge
  const prevMap = new Map<string, Set<string>>()            // stepId -> set of prevIds
  const stepIds = new Set(steps.map((s) => s.id))

  for (const step of steps) {
    const nexts: StepEdge[] = safeJsonParse(step.nextSteps, [])
    const prevs: string[] = safeJsonParse(step.prevSteps, [])

    const edgeMap = new Map<string, StepEdge>()
    for (const edge of nexts) {
      if (stepIds.has(edge.targetStepId)) {
        edgeMap.set(edge.targetStepId, edge)
      }
    }
    nextMap.set(step.id, edgeMap)
    prevMap.set(step.id, new Set(prevs.filter((id) => stepIds.has(id))))
  }

  // Synthesize missing edges
  let dirty = false

  // For every prevSteps[B] = A, ensure nextSteps[A] contains B
  for (const step of steps) {
    const prevs = prevMap.get(step.id)!
    for (const prevId of prevs) {
      const prevNexts = nextMap.get(prevId)!
      if (!prevNexts.has(step.id)) {
        prevNexts.set(step.id, { targetStepId: step.id })
        dirty = true
      }
    }
  }

  // For every nextSteps[A] -> B, ensure prevSteps[B] contains A
  for (const step of steps) {
    const nexts = nextMap.get(step.id)!
    for (const [targetId] of nexts) {
      const targetPrevs = prevMap.get(targetId)
      if (targetPrevs && !targetPrevs.has(step.id)) {
        targetPrevs.add(step.id)
        dirty = true
      }
    }
  }

  if (!dirty) return

  // Write back all modified edges
  for (const step of steps) {
    const nexts = Array.from(nextMap.get(step.id)!.values())
    const prevs = Array.from(prevMap.get(step.id)!)
    const newNextSteps = nexts.length > 0 ? JSON.stringify(nexts) : null
    const newPrevSteps = prevs.length > 0 ? JSON.stringify(prevs) : null

    if (newNextSteps !== step.nextSteps || newPrevSteps !== step.prevSteps) {
      await db.taskStep.update({
        where: { id: step.id },
        data: { nextSteps: newNextSteps, prevSteps: newPrevSteps },
      })
    }
  }
}
