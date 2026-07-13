import { db } from '@/lib/db'
import { getAdapter } from '@/lib/server/adapters/registry'
import { buildWorkingMemory, buildRelevantMemoryWithHits } from '@/lib/server/memory'
import { resolvePrompt } from '@/lib/server/resolve-prompt'
import { buildSkillsBlock } from '@/lib/server/skill-prompt'
import { fireProjectEvent as broadcastProjectEvent } from '@/lib/server/project-event'
import { resolveMcpTools } from '@/lib/server/mcp-resolver'
import { estimateCost } from '@/lib/server/cost-estimator'
import { createExecution, succeedExecution, failExecution, timeoutExecution } from '@/lib/server/execution-log'
import { resolveNextSteps, type StepEdge } from '@/lib/server/condition-evaluator'
import { findPreviousAgentStep, normalizeDagEdges, hasDagEdges } from '@/lib/server/dag-edges'
import { getLogger } from '@/lib/server/logger'
import { appendStepEvent, computeBackoffMs, moveToDeadLetter } from '@/lib/server/step-events'
import { notifyDeadLetter, notifyReviewGateWaiting } from '@/lib/server/notifications'
import { LEASE_TIMEOUT_MS } from '@/lib/server/step-queue'
import { dispatchWithTelemetry } from '@/lib/server/telemetry'
import { safeJsonParse } from '@/lib/server/utils'
import { randomBytes } from 'crypto'

// Re-export DAG helpers so existing importers (review-logic, task routes) keep working.
export { findPreviousAgentStep, normalizeDagEdges }

const log = getLogger('dispatch')
const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`

// ---------------------------------------------------------------------------
// Test seams (B-6-T1). Bun's module registry is shared across test files, so
// mock.module'ing collaborators that have their own real-module test suites
// (adapters/registry, memory, mcp-resolver) would leak the mock into those
// suites. dispatchStep resolves these collaborators through this mutable
// indirection instead. Production defaults are the real implementations —
// behaviour is unchanged unless a test overrides them.
// ---------------------------------------------------------------------------
export const dispatchDeps = {
  getAdapter,
  buildWorkingMemory,
  buildRelevantMemoryWithHits,
  resolveMcpTools,
}

export function setDispatchDeps(overrides: Partial<typeof dispatchDeps>): void {
  Object.assign(dispatchDeps, overrides)
}

export function resetDispatchDeps(): void {
  dispatchDeps.getAdapter = getAdapter
  dispatchDeps.buildWorkingMemory = buildWorkingMemory
  dispatchDeps.buildRelevantMemoryWithHits = buildRelevantMemoryWithHits
  dispatchDeps.resolveMcpTools = resolveMcpTools
}

// Exported for direct unit testing — see lease-step.test.ts. Callers should
// normally go through dispatchStep(); leaseStep on its own doesn't run the
// step, just marks it.
export async function leaseStep(stepId: string): Promise<{ taken: boolean; evictedFrom: string | null }> {
  // Capture the prior lease holder so we can record eviction on a successful
  // steal. The read-then-updateMany pair is not atomic, but the updateMany's
  // `where` still enforces correctness — the prior field is only used for the
  // audit-log row, so a rare stale value is acceptable.
  const prior = await db.taskStep.findUnique({
    where: { id: stepId },
    select: { leasedBy: true },
  })

  const leaseExpiry = new Date(Date.now() - LEASE_TIMEOUT_MS)
  const result = await db.taskStep.updateMany({
    where: {
      id: stepId,
      status: 'active',
      OR: [
        { leasedBy: null },
        { leasedBy: WORKER_ID },
        // Steal a lease whose owner hasn't checked in within LEASE_TIMEOUT_MS.
        // Without this, a worker crash strands the step forever.
        { leasedAt: { lt: leaseExpiry } },
      ],
    },
    data: {
      leasedBy: WORKER_ID,
      leasedAt: new Date(),
    },
  })

  if (result.count === 0) return { taken: false, evictedFrom: null }

  const evictedFrom =
    prior?.leasedBy && prior.leasedBy !== WORKER_ID ? prior.leasedBy : null
  return { taken: true, evictedFrom }
}

// ---------------------------------------------------------------------------
// In-process re-entry guard (B-1). leaseStep deliberately lets a worker
// re-take its own lease (that is how a live worker's retries proceed), which
// means the DB lease alone cannot stop the SAME process from dispatching a
// step twice when poll cycles overlap. Steps this process is currently
// dispatching are tracked here; re-entry exits silently.
// ---------------------------------------------------------------------------
const inFlightSteps = new Set<string>()

export async function dispatchStep(stepId: string) {
  if (inFlightSteps.has(stepId)) return
  inFlightSteps.add(stepId)
  try {
    // B-1: take the lease FIRST, before the step load and the expensive
    // prelude (memory build, embeddings, MCP resolution). pollAndDispatch
    // selects steps before they are leased — if the prelude outlasts the poll
    // interval, the next cycle re-selects the still-unleased step. Leasing up
    // front makes that second selection lose here instead of after both have
    // paid for the prelude (and dispatched to the LLM).
    const leased = await leaseStep(stepId)
    if (!leased.taken) return

    await appendStepEvent(stepId, 'leased', {
      worker: WORKER_ID,
      ...(leased.evictedFrom ? { evictedFrom: leased.evictedFrom } : {}),
    })

    // Any unexpected throw while we hold the lease but haven't recorded an
    // execution yet must give the lease back — otherwise the step is stuck
    // until the lease-timeout sweep.
    let prepared: Awaited<ReturnType<typeof prepareDispatch>>
    try {
      prepared = await prepareDispatch(stepId, leased.evictedFrom)
    } catch (err) {
      await releaseLease(stepId)
      throw err
    }
    if (!prepared) return

    await executeDispatch(stepId, prepared)
  } finally {
    inFlightSteps.delete(stepId)
  }
}

/** Clears this worker's lease without touching step status. */
async function releaseLease(stepId: string) {
  await db.taskStep.updateMany({
    where: { id: stepId, leasedBy: WORKER_ID },
    data: { leasedBy: null, leasedAt: null },
  })
}

/**
 * Loads the step and assembles everything the adapter call needs (prompt,
 * memory, tools, runtime config). Returns null on a handled early exit —
 * every such path either releases the lease or clears it as part of a status
 * change, so the caller doesn't have to.
 */
/** Minimal step/agent shapes the prompt resolver needs (both the HTTP
 *  prepareDispatch load and the daemon payload route's query satisfy them). */
interface ResolvableStep {
  taskId: string
  order: number
  mode: string
  instructions: string | null
  prevSteps: string | null
  task: { title: string; description: string | null; projectId: string }
}
interface ResolvableAgent {
  id: string
  name: string
  role: string | null
  capabilities: string | null
  personality: string | null
  systemPrompt: string | null
  modeInstructions: string | null
  skillIds: string | null
}

/**
 * Resolve a step's system prompt and gather its dispatch context — the previous
 * step's output, the project mode, the layered mode instructions, and the
 * working/relevant memory — then run resolvePrompt over the agent's system
 * prompt template. Extracted (G1-1-T3) from prepareDispatch so the DAEMON
 * payload route resolves prompts identically instead of shipping raw
 * `{{task.title}}`/`{{memory.recent}}` tokens to the CLI (gaps 1.1/1.2).
 */
export async function buildResolvedPrompt(step: ResolvableStep, agent: ResolvableAgent) {
  // Find predecessor step: use prevSteps edges for DAG, order-1 for linear
  let previousStep: { output: string | null } | null = null
  if (step.prevSteps) {
    const prevIds: string[] = safeJsonParse(step.prevSteps, [])
    if (prevIds.length > 0) {
      const prevSteps = await db.taskStep.findMany({
        where: { id: { in: prevIds } },
        select: { output: true },
      })
      if (prevSteps.length === 1) {
        previousStep = prevSteps[0]
      } else if (prevSteps.length > 1) {
        const combinedOutput = prevSteps
          .filter(s => s.output)
          .map(s => s.output)
          .join('\n\n---\n\n')
        previousStep = { output: combinedOutput || null }
      }
    }
  } else {
    previousStep = await db.taskStep.findFirst({
      where: { taskId: step.taskId, order: step.order - 1 },
      select: { output: true },
    })
  }

  const projectMode = await db.projectMode.findFirst({
    where: { projectId: step.task.projectId, name: step.mode },
  })

  const agentModeInstructions = agent.modeInstructions
    ? safeJsonParse<Record<string, string>>(agent.modeInstructions, {})[step.mode] ?? null
    : null

  let modeInstructions = agentModeInstructions || projectMode?.instructions || ''

  // Mode policy (Epic S4): output-format hint rides the mode-instruction layer
  if (projectMode?.outputFormat) {
    modeInstructions = `${modeInstructions}\nRespond in ${projectMode.outputFormat} format.`.trim()
  }

  const capabilities = agent.capabilities
    ? safeJsonParse<string[]>(agent.capabilities, []).join(', ')
    : ''

  // ADR-0010 (G3-1): load the agent's attached skills, workspace-filtered —
  // a stale or cross-workspace id drops out here (defense in depth on top of
  // the write-time validation) instead of leaking across the boundary.
  const skillIds = agent.skillIds ? safeJsonParse<string[]>(agent.skillIds, []) : []
  let injectedSkills: { title: string; body: string }[] = []
  if (skillIds.length > 0) {
    const project = await db.project.findUnique({
      where: { id: step.task.projectId },
      select: { workspaceId: true },
    })
    if (project?.workspaceId) {
      const rows = await db.skill.findMany({
        where: { id: { in: skillIds }, workspaceId: project.workspaceId },
        select: { id: true, title: true, body: true },
      })
      const byId = new Map(rows.map(r => [r.id, r]))
      // Attach order is the injection order (ADR-0010) — findMany doesn't keep it.
      injectedSkills = skillIds.flatMap(id => {
        const row = byId.get(id)
        return row ? [{ title: row.title, body: row.body }] : []
      })
    }
  }
  const skillsBlock = buildSkillsBlock(injectedSkills)

  const memoryQuery = [step.task.title, step.task.description, step.instructions]
    .filter(Boolean)
    .join('\n')

  const [workingMemory, relevantMemoryResult] = await Promise.all([
    dispatchDeps.buildWorkingMemory({
      agentId: agent.id,
      projectId: step.task.projectId,
    }),
    dispatchDeps.buildRelevantMemoryWithHits({
      agentId: agent.id,
      projectId: step.task.projectId,
      query: memoryQuery,
      limit: 5,
    }),
  ])
  const relevantMemory = relevantMemoryResult.text

  const resolveCtx = {
    task: { title: step.task.title, description: step.task.description },
    step: { mode: step.mode, instructions: step.instructions, previousOutput: previousStep?.output },
    mode: { label: projectMode?.label || step.mode, instructions: modeInstructions },
    agent: { name: agent.name, role: agent.role, capabilities, personality: agent.personality, skills: skillsBlock },
    memory: { recent: workingMemory, relevant: relevantMemory },
  }

  // ADR-0010: token-override-else-append. A `{{agent.skills}}` token in the
  // template controls placement; without one the block is appended, so the
  // attach action alone makes skills reach the prompt (both execution paths —
  // the daemon consumes this same resolved systemPrompt).
  let systemPrompt = resolvePrompt(agent.systemPrompt || '', resolveCtx)
  if (skillsBlock && !(agent.systemPrompt || '').includes('{{agent.skills}}')) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillsBlock}` : skillsBlock
  }
  // Resolve instruction tokens too, so the daemon payload never ships a literal
  // `{{task.title}}`/`{{memory.recent}}` to the CLI (G1-1-T3, AC). The HTTP path
  // consumes `resolvedInstructions` from G1-1-T3 onward as well.
  const resolvedInstructions = step.instructions
    ? resolvePrompt(step.instructions, resolveCtx)
    : step.instructions

  return {
    previousStep,
    projectMode,
    modeInstructions,
    systemPrompt,
    resolvedInstructions,
    workingMemory,
    relevantMemoryResult,
    // ADR-0010: which playbooks shaped this prompt — evidence for reviewers.
    injectedSkillTitles: injectedSkills.map(s => s.title),
  }
}

async function prepareDispatch(stepId: string, evictedFrom: string | null) {
  const step = await db.taskStep.findUnique({
    where: { id: stepId },
    include: {
      task: true,
      agent: true,
    },
  })

  if (!step || !step.agent || step.status !== 'active') {
    // leaseStep only succeeds on an active step, but the state may have moved
    // between the lease and this read — give the lease back and bail.
    await releaseLease(stepId)
    return null
  }

  if (evictedFrom) {
    log.warn(`reclaimed expired lease from ${evictedFrom} on step ${stepId}`)
    await db.activityLog.create({
      data: {
        action: 'lease_reclaimed',
        taskId: step.taskId,
        agentId: step.agentId,
        projectId: step.task.projectId,
        details: JSON.stringify({ stepId, previousLeaseholder: evictedFrom, newLeaseholder: WORKER_ID }),
      },
    })
  }

  const agent = step.agent
  if (agent.projectId !== step.task.projectId) {
    // failStep clears the lease along with the status change.
    await failStep(stepId, step.task.projectId, 'Agent does not belong to this project')
    return null
  }
  if (!agent.runtimeId) {
    await releaseLease(stepId)
    return null
  }

  const runtime = await db.projectRuntime.findUnique({
    where: { id: agent.runtimeId },
  })

  if (!runtime) {
    await failStep(stepId, step.task.projectId, 'Runtime not found')
    return null
  }

  const adapter = dispatchDeps.getAdapter(runtime.adapter)
  if (!adapter || !adapter.available) {
    await failStep(stepId, step.task.projectId, `Adapter "${runtime.adapter}" not available`)
    return null
  }

  const activeCount = await db.taskStep.count({
    where: { agentId: agent.id, status: 'active', id: { not: stepId } },
  })
  if (activeCount >= agent.maxConcurrent) {
    // Demote AND clear the lease we now hold — a pending step carrying a
    // stale lease would be skipped by the poller once it is re-activated.
    await db.taskStep.update({
      where: { id: stepId },
      data: { status: 'pending', leasedBy: null, leasedAt: null },
    })
    return null
  }

  const { previousStep, projectMode, systemPrompt, resolvedInstructions, workingMemory, relevantMemoryResult, injectedSkillTitles } =
    await buildResolvedPrompt(step, agent)

  const taskContext = [
    `Task: ${step.task.title}`,
    step.task.description ? `Description: ${step.task.description}` : '',
    resolvedInstructions ? `Step Instructions: ${resolvedInstructions}` : '',
  ].filter(Boolean).join('\n\n')

  const rejectionContext = step.rejectionNote
    ? `\n\nHUMAN FEEDBACK (from previous attempt #${step.attempts}):\n${step.rejectionNote}\n\nPlease address this feedback in your revised response.`
    : ''

  const fullTaskContext = taskContext + rejectionContext

  const mcpConnectionIds = agent.mcpConnectionIds
    ? safeJsonParse<string[]>(agent.mcpConnectionIds, [])
    : []

  // Mode policy (Epic S4): the mode's explicit allowlist narrows the
  // built-in heuristics further (layers compose).
  const modeToolAllowlist = safeJsonParse<string[] | null>(projectMode?.toolAllowlist ?? null, null)
  const tools = await dispatchDeps.resolveMcpTools(mcpConnectionIds, step.mode, modeToolAllowlist)

  const runtimeConfig: Record<string, unknown> = {
    ...safeJsonParse<Record<string, unknown>>(runtime.config, {}),
    apiKeyEnvVar: runtime.apiKeyEnvVar,
    endpoint: runtime.endpoint,
  }

  return {
    step,
    agent,
    adapter,
    systemPrompt,
    fullTaskContext,
    previousStep,
    tools,
    runtimeConfig,
    mcpConnectionIds,
    workingMemory,
    relevantMemoryResult,
    injectedSkillTitles,
  }
}

type PreparedDispatch = NonNullable<Awaited<ReturnType<typeof prepareDispatch>>>

// B-1: attempt numbers are allocated by inserting against the
// (stepId, attempt) unique constraint and advancing on conflict — never from
// count(), whose racy read let two staggered dispatchers derive DIFFERENT
// attempt numbers and both insert (double dispatch). The lease is the mutual
// exclusion; this loop only guarantees a fresh, correct number.
const ATTEMPT_ALLOCATION_RETRIES = 5

async function allocateExecution(stepId: string) {
  const latest = await db.stepExecution.findFirst({
    where: { stepId },
    orderBy: { attempt: 'desc' },
    select: { attempt: true },
  })
  let attempt = (latest?.attempt ?? 0) + 1

  for (let i = 0; i < ATTEMPT_ALLOCATION_RETRIES; i++) {
    try {
      return { execution: await createExecution(stepId, attempt), attempt }
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        log.warn(`attempt ${attempt} of step ${stepId} already exists — advancing to ${attempt + 1}`)
        attempt += 1
        continue
      }
      throw err
    }
  }
  return null
}

/**
 * The minimal step shape the Finalizer needs. Both `PreparedDispatch.step` (HTTP
 * path) and the daemon route's step query satisfy it structurally.
 */
export interface FinalizableStep {
  id: string
  taskId: string
  agentId: string | null
  mode: string
  instructions: string | null
  maxRetries: number | null
  retryDelayMs: number | null
  fallbackAgentId: string | null
  task: { projectId: string; title: string }
}

/**
 * Close a step attempt that SUCCEEDED. Extracted (G1-1-T1) from executeDispatch
 * so the daemon completion route can finalize identically to the HTTP path:
 * execution row → step row → event → artifacts → board broadcast → chain advance.
 * `executionId` may be null when no StepExecution row exists (daemon before
 * G1-1-T4); the execution write is then skipped. `eventMeta` merges extra keys
 * into the `succeeded` event (e.g. the daemon's source/daemonId) — omitted on the
 * HTTP path, so its behaviour is unchanged.
 */
export async function finalizeStepSuccess(opts: {
  step: FinalizableStep
  attemptNumber: number
  executionId: string | null
  output: string
  tokensUsed?: number | null
  cost?: number | null
  artifacts?: Array<{ type: string; label: string; content?: string | null; url?: string | null; mimeType?: string | null }>
  eventMeta?: Record<string, unknown>
}): Promise<void> {
  const { step, attemptNumber, executionId, output, tokensUsed, cost, artifacts, eventMeta } = opts
  const stepId = step.id

  if (executionId) {
    await succeedExecution(executionId, output, tokensUsed ?? undefined, cost ?? undefined)
  }

  await db.taskStep.update({
    where: { id: stepId },
    data: {
      status: 'done',
      output,
      attempts: attemptNumber,
      completedAt: new Date(),
      leasedBy: null,
      leasedAt: null,
    },
  })

  await appendStepEvent(stepId, 'succeeded', {
    attempt: attemptNumber,
    tokensUsed: tokensUsed ?? null,
    ...eventMeta,
  })

  if (artifacts && artifacts.length > 0) {
    await db.stepArtifact.createMany({
      data: artifacts.map(artifact => ({
        stepId,
        executionId,
        type: artifact.type,
        label: artifact.label,
        content: artifact.content || null,
        url: artifact.url || null,
        mimeType: artifact.mimeType || null,
      })),
    })
  }

  broadcastProjectEvent(step.task.projectId, 'step-completed', {
    taskId: step.taskId,
    stepId,
    output,
    attempt: attemptNumber,
    tokensUsed,
  })

  await advanceChain(step.taskId, step.task.projectId, stepId)
}

/**
 * Close a step attempt that FAILED. Extracted (G1-1-T1) from executeDispatch:
 * record the execution failure, then apply the SERVER-authoritative retry policy
 * (step maxRetries/backoff) → retry, else fallback agent, else dead-letter +
 * notification + task-status resolution. Returns the outcome so callers can log
 * it. `executionId` null → skip the execution-log write (daemon before T4).
 */
export async function finalizeStepFailure(opts: {
  step: FinalizableStep
  attemptNumber: number
  executionId: string | null
  message: string
  isTimeout: boolean
  eventMeta?: Record<string, unknown>
}): Promise<'retry_scheduled' | 'fallback' | 'dead_lettered'> {
  const { step, attemptNumber, executionId, message, isTimeout, eventMeta } = opts
  const stepId = step.id

  if (executionId) {
    if (isTimeout) await timeoutExecution(executionId)
    else await failExecution(executionId, message)
  }

  await appendStepEvent(stepId, 'failed', {
    attempt: attemptNumber,
    error: message,
    timeout: isTimeout,
    ...eventMeta,
  })

  const maxRetries = step.maxRetries ?? 2
  const retryDelayMs = step.retryDelayMs ?? 5000

  if (attemptNumber < maxRetries + 1) {
    // Retry: keep step active, schedule for re-pickup with exponential backoff
    // + jitter (leasedAt doubles as the "not before" time).
    const delayMs = retryDelayMs > 0 ? computeBackoffMs(attemptNumber, retryDelayMs) : 0
    const retryAt = delayMs > 0 ? new Date(Date.now() + delayMs) : null

    await db.taskStep.update({
      where: { id: stepId },
      data: { attempts: attemptNumber, leasedBy: null, leasedAt: retryAt },
    })

    await appendStepEvent(stepId, 'retry_scheduled', {
      attempt: attemptNumber,
      delayMs,
      retryAt: retryAt?.toISOString() ?? null,
      error: message,
      ...eventMeta,
    })

    broadcastProjectEvent(step.task.projectId, 'step-retrying', {
      taskId: step.taskId,
      stepId,
      attempt: attemptNumber,
      maxRetries,
      error: message,
    })
    return 'retry_scheduled'
  }

  // Exhausted retries — check for fallback agent before dead-lettering.
  if (step.fallbackAgentId && step.fallbackAgentId !== step.agentId) {
    await db.taskStep.update({
      where: { id: stepId },
      data: {
        agentId: step.fallbackAgentId,
        status: 'active',
        error: null,
        attempts: 0,
        leasedBy: null,
        leasedAt: null,
      },
    })

    broadcastProjectEvent(step.task.projectId, 'step-fallback', {
      taskId: step.taskId,
      stepId,
      fromAgentId: step.agentId,
      toAgentId: step.fallbackAgentId,
      reason: message,
    })
    return 'fallback'
  }

  // No fallback — snapshot into the dead-letter table, then mark failed.
  await moveToDeadLetter(
    {
      id: stepId,
      taskId: step.taskId,
      agentId: step.agentId,
      mode: step.mode,
      instructions: step.instructions,
      attempts: attemptNumber,
    },
    message,
  )

  await db.taskStep.update({
    where: { id: stepId },
    data: {
      status: 'failed',
      error: `Failed after ${attemptNumber} attempts. Last error: ${message}`,
      attempts: attemptNumber,
      completedAt: new Date(),
      leasedBy: null,
      leasedAt: null,
    },
  })

  broadcastProjectEvent(step.task.projectId, 'step-failed', {
    taskId: step.taskId,
    stepId,
    error: message,
    attempt: attemptNumber,
    maxRetries,
    mode: step.mode,
    exhaustedRetries: true,
  })

  // C-4: a dead-lettered step needs a human — notify (never throws).
  await notifyDeadLetter({
    projectId: step.task.projectId,
    taskId: step.taskId,
    taskTitle: step.task.title,
    stepId,
    error: message,
  })

  // Use resolveTaskStatus instead of hardcoding WAITING — other parallel
  // branches may still be active and the task should stay IN_PROGRESS.
  await resolveTaskStatus(step.taskId, step.task.projectId)
  return 'dead_lettered'
}

async function executeDispatch(stepId: string, prepared: PreparedDispatch) {
  const {
    step,
    agent,
    adapter,
    systemPrompt,
    fullTaskContext,
    previousStep,
    tools,
    runtimeConfig,
    mcpConnectionIds,
    workingMemory,
    relevantMemoryResult,
    injectedSkillTitles,
  } = prepared

  const allocated = await allocateExecution(stepId)
  if (!allocated) {
    log.error(`could not allocate an execution attempt for step ${stepId} after ${ATTEMPT_ALLOCATION_RETRIES} conflicts`)
    await releaseLease(stepId)
    return
  }
  const { execution, attempt: attemptNumber } = allocated

  await appendStepEvent(stepId, 'started', { attempt: attemptNumber, executionId: execution.id })

  // Retrieval evidence: which memories were injected into this prompt exists
  // only here — persist it on the execution. Best-effort: evidence capture
  // must never block dispatch.
  void db.stepExecution
    .update({
      where: { id: execution.id },
      data: {
        evidence: JSON.stringify({
          memoryHits: relevantMemoryResult.hits,
          workingMemory: workingMemory.length > 0,
          // ADR-0010: which attached skills were injected into this prompt.
          skillsInjected: injectedSkillTitles,
        }),
      },
    })
    .catch(() => {})

  if (attemptNumber === 1) {
    await db.taskStep.updateMany({
      where: { id: stepId, status: 'active' },
      data: { startedAt: new Date() },
    })
  }

  const timeoutMs = step.timeoutMs || 300000

  try {
    const result = await Promise.race([
      dispatchWithTelemetry(adapter, {
        systemPrompt,
        taskContext: fullTaskContext,
        previousOutput: previousStep?.output || undefined,
        mode: step.mode,
        model: agent.runtimeModel || 'default',
        runtimeConfig,
        tools: tools.length > 0 ? tools : undefined,
        mcpConnectionIds: mcpConnectionIds.length > 0 ? mcpConnectionIds : undefined,
        executionId: execution.id,
      }, step.traceContext),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('STEP_TIMEOUT')), timeoutMs)
      ),
    ])

    // TD-018: persist the recorded cost on the execution row. Prefer the
    // adapter-reported figure; when the adapter reports token usage but no
    // cost (the Anthropic SDK path), fall back to the model-rate estimate so
    // B-7 budget enforcement has a recorded spend to aggregate. Unknown
    // models estimate to 0 → recorded as null, never a fake zero. Adapters
    // report no cost on the failure path (they throw), so only success
    // records spend.
    const recordedCost =
      result.cost ??
      (result.tokensUsed != null
        ? estimateCost(agent.runtimeModel || '', result.tokensUsed) || undefined
        : undefined)

    await finalizeStepSuccess({
      step,
      attemptNumber,
      executionId: execution.id,
      output: result.output,
      tokensUsed: result.tokensUsed,
      cost: recordedCost,
      artifacts: result.artifacts,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown dispatch error'
    const isTimeout = message === 'STEP_TIMEOUT'

    await finalizeStepFailure({
      step,
      attemptNumber,
      executionId: execution.id,
      message,
      isTimeout,
    })
  }
}

async function failStep(stepId: string, projectId: string, error: string) {
  const step = await db.taskStep.update({
    where: { id: stepId },
    data: { status: 'failed', error, completedAt: new Date(), leasedBy: null, leasedAt: null },
  })

  // Use resolveTaskStatus instead of hardcoding WAITING — other parallel
  // branches may still be active.
  await resolveTaskStatus(step.taskId, projectId)

  broadcastProjectEvent(projectId, 'step-failed', {
    taskId: step.taskId,
    stepId,
    error,
    mode: step.mode,
  })
}

export async function advanceChain(taskId: string, projectId: string, completedStepId?: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    orderBy: { order: 'asc' },
    include: { agent: true },
  })

  // Check if this is a DAG chain (any step has nextSteps) or linear
  const isDag = hasDagEdges(steps)

  if (isDag) {
    // In DAG mode, advance from the specific step that just completed.
    // If no completedStepId provided, advance from ALL recently completed steps
    // to handle any that may have been missed.
    const completedSteps = completedStepId
      ? steps.filter(s => s.id === completedStepId && (s.status === 'done' || s.status === 'skipped'))
      : steps.filter(s => s.status === 'done' || s.status === 'skipped')

    for (const completedStep of completedSteps) {
      await advanceChainDag(taskId, projectId, steps, completedStep)
    }
  } else {
    // Linear mode: find the last completed step by order
    const lastDoneStep = [...steps].reverse().find((s) => s.status === 'done' || s.status === 'skipped')
    if (!lastDoneStep) return
    await advanceChainLinear(taskId, projectId, steps, lastDoneStep)
  }
}

type StepWithAgent = Awaited<ReturnType<typeof db.taskStep.findMany<{ include: { agent: true } }>>>[number]

async function advanceChainLinear(
  taskId: string,
  projectId: string,
  steps: StepWithAgent[],
  lastDoneStep: StepWithAgent,
) {
  const nextStep = steps.find((s) => s.order === lastDoneStep.order + 1)

  if (!nextStep) {
    await db.task.update({
      where: { id: taskId },
      data: { status: 'DONE', completedAt: new Date() },
    })
    broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    return
  }

  if (!lastDoneStep.autoContinue) {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  await activateStep(taskId, projectId, nextStep, lastDoneStep.id)
  await resolveTaskStatus(taskId, projectId)
}

async function advanceChainDag(
  taskId: string,
  projectId: string,
  steps: StepWithAgent[],
  completedStep: StepWithAgent,
) {
  // Parse edges from the completed step
  const edges: StepEdge[] = safeJsonParse(completedStep.nextSteps, [])

  if (edges.length === 0) {
    // No outgoing edges — check if ALL steps are done/skipped (chain complete)
    const allDone = steps.every(s => s.status === 'done' || s.status === 'skipped')
    if (allDone) {
      await db.task.update({
        where: { id: taskId },
        data: { status: 'DONE', completedAt: new Date() },
      })
      broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    }
    return
  }

  if (!completedStep.autoContinue) {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  // Get the latest execution for condition context
  const latestExecution = await db.stepExecution.findFirst({
    where: { stepId: completedStep.id },
    orderBy: { attempt: 'desc' },
  })

  // Build context for condition evaluation
  const context = {
    output: completedStep.output,
    status: completedStep.status,
    tokensUsed: latestExecution?.tokensUsed ?? null,
    error: completedStep.error,
  }

  // Resolve which next steps to activate
  const targetStepIds = resolveNextSteps(edges, context)

  if (targetStepIds.length === 0) {
    // No conditions matched and no default path — chain is stuck
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
    return
  }

  // Activate each target step (parallel branching if multiple)
  for (const targetStepId of targetStepIds) {
    const targetStep = steps.find(s => s.id === targetStepId)
    if (!targetStep) continue

    // If target is a merge point, check that ALL its prevSteps are done
    if (targetStep.isMergePoint && targetStep.prevSteps) {
      const prevStepIds: string[] = safeJsonParse(targetStep.prevSteps, [])
      const allPrevDone = prevStepIds.every(prevId => {
        const prevStep = steps.find(s => s.id === prevId)
        return prevStep && (prevStep.status === 'done' || prevStep.status === 'skipped')
      })

      if (!allPrevDone) {
        // Not all incoming branches are done yet — skip activation
        continue
      }
    }

    await activateStep(taskId, projectId, targetStep, completedStep.id)
  }

  // Resolve task status after all activations
  await resolveTaskStatus(taskId, projectId)
}

async function activateStep(
  taskId: string,
  projectId: string,
  step: StepWithAgent,
  fromStepId: string,
) {
  const activated = await db.taskStep.updateMany({
    where: { id: step.id, status: 'pending' },
    data: { status: 'active' },
  })
  if (activated.count === 0) return // another caller already activated it

  broadcastProjectEvent(projectId, 'step-activated', {
    taskId,
    stepId: step.id,
  })

  broadcastProjectEvent(projectId, 'chain-advanced', {
    taskId,
    fromStepId,
    toStepId: step.id,
  })

  // C-4: an activated human gate is now waiting for sign-off — notify (never throws).
  if (step.mode === 'human') {
    await notifyReviewGateWaiting({ projectId, taskId, stepId: step.id, humanLabel: step.humanLabel })
  }

  // Don't set task status here — let the caller resolve it after all activations
}

/**
 * Compute the correct task status from its steps.
 * - Any active agent step with a runtime → IN_PROGRESS
 * - Only human/no-runtime active steps → WAITING
 * - All done/skipped → DONE
 */
export async function resolveTaskStatus(taskId: string, projectId: string) {
  const steps = await db.taskStep.findMany({
    where: { taskId },
    select: { status: true, mode: true, agent: { select: { runtimeId: true } } },
  })

  const allDone = steps.every(s => s.status === 'done' || s.status === 'skipped')
  if (allDone) {
    await db.task.update({
      where: { id: taskId },
      data: { status: 'DONE', completedAt: new Date() },
    })
    broadcastProjectEvent(projectId, 'chain-completed', { taskId })
    return
  }

  const hasActiveAgentStep = steps.some(
    s => s.status === 'active' && s.mode !== 'human' && s.agent?.runtimeId
  )

  if (hasActiveAgentStep) {
    await db.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } })
  } else {
    await db.task.update({ where: { id: taskId }, data: { status: 'WAITING' } })
  }
}

export async function rewindChain(
  taskId: string,
  projectId: string,
  targetStepId: string,
  rejectionNote: string,
) {
  const targetStep = await db.taskStep.findUnique({
    where: { id: targetStepId },
    include: { agent: true },
  })

  if (!targetStep) throw new Error('Target step not found')

  await db.taskStep.update({
    where: { id: targetStepId },
    data: {
      status: 'active',
      output: null,
      error: null,
      rejectionNote,
      attempts: { increment: 1 },
      startedAt: null,
      completedAt: null,
    },
  })

  // Reset downstream steps. In DAG mode, find all steps reachable from
  // the target via nextSteps edges. In linear mode, use order > target.
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    select: { id: true, order: true, nextSteps: true, prevSteps: true, isMergePoint: true },
  })

  const isDag = hasDagEdges(allSteps)

  let resetIds: string[]
  if (isDag) {
    const visited = new Set<string>()
    visited.add(targetStepId) // seed with target to prevent cycles

    // Forward BFS: find all downstream steps reachable via nextSteps
    const forwardQueue = [targetStepId]
    while (forwardQueue.length > 0) {
      const current = forwardQueue.shift()!
      const step = allSteps.find(s => s.id === current)
      if (!step?.nextSteps) continue
      const edges: Array<{ targetStepId: string }> = safeJsonParse(step.nextSteps, [])
      for (const edge of edges) {
        if (!visited.has(edge.targetStepId)) {
          visited.add(edge.targetStepId)
          forwardQueue.push(edge.targetStepId)
        }
      }
    }

    // If the target step is a merge point, also reset its sibling branches
    // (steps that feed into it via prevSteps) so they re-execute
    const target = allSteps.find(s => s.id === targetStepId)
    if (target?.isMergePoint && target.prevSteps) {
      const prevIds: string[] = safeJsonParse(target.prevSteps, [])
      // Reverse BFS: walk backward from each prevStep to find all ancestor steps
      const reverseQueue = [...prevIds]
      for (const pid of reverseQueue) {
        if (!visited.has(pid)) visited.add(pid)
      }
      while (reverseQueue.length > 0) {
        const current = reverseQueue.shift()!
        const step = allSteps.find(s => s.id === current)
        if (!step?.prevSteps) continue
        const ancestors: string[] = safeJsonParse(step.prevSteps, [])
        for (const ancestorId of ancestors) {
          if (!visited.has(ancestorId)) {
            visited.add(ancestorId)
            reverseQueue.push(ancestorId)
          }
        }
      }
    }

    // Remove the target step itself from the reset list (it's handled separately above)
    visited.delete(targetStepId)
    resetIds = Array.from(visited)
  } else {
    resetIds = allSteps
      .filter(s => s.order > targetStep.order)
      .map(s => s.id)
  }

  if (resetIds.length > 0) {
    await db.taskStep.updateMany({
      where: { id: { in: resetIds } },
      data: {
        status: 'pending',
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
      },
    })

    // Supersede any reviews on the reset steps — stale approvals from a
    // previous round must not count toward the next sign-off gate.
    await db.stepReview.updateMany({
      where: { stepId: { in: resetIds }, supersededAt: null },
      data: { supersededAt: new Date() },
    })
  }

  await db.task.update({
    where: { id: taskId },
    data: { status: 'IN_PROGRESS' },
  })

  broadcastProjectEvent(projectId, 'chain-rewound', {
    taskId,
    targetStepId,
    rejectionNote,
  })

  // Step is active — the queue will pick it up on next poll
}

export async function closeChain(taskId: string, projectId: string, note: string) {
  await db.taskStep.updateMany({
    where: {
      taskId,
      status: { in: ['pending', 'active'] },
    },
    data: { status: 'skipped' },
  })

  await db.task.update({
    where: { id: taskId },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      output: `Chain closed: ${note}`,
    },
  })

  broadcastProjectEvent(projectId, 'chain-completed', { taskId, closed: true, note })
}

export async function startChain(taskId: string, projectId: string) {
  const allSteps = await db.taskStep.findMany({
    where: { taskId },
    include: { agent: true },
    orderBy: { order: 'asc' },
  })

  if (allSteps.length === 0) return

  // Check if this is a DAG chain
  const isDag = hasDagEdges(allSteps)

  // Find root steps: in DAG mode = steps with no prevSteps; in linear mode = order 1
  const rootSteps = isDag
    ? allSteps.filter(s => {
        const prev = safeJsonParse<string[]>(s.prevSteps, [])
        return prev.length === 0
      })
    : allSteps.filter(s => s.order === 1)

  if (rootSteps.length === 0) {
    log.error('startChain: no root steps found — possible cyclic DAG or edge normalization issue', undefined, { taskId })
    await db.task.update({
      where: { id: taskId },
      data: {
        status: 'WAITING',
        notes: 'Chain could not start: no root steps found. This may indicate a cyclic workflow or edge configuration issue. Please review the task steps.',
      },
    })
    broadcastProjectEvent(projectId, 'chain-error', {
      taskId,
      error: 'No root steps found — possible cyclic DAG',
    })
    return
  }

  for (const rootStep of rootSteps) {
    const activated = await db.taskStep.updateMany({
      where: { id: rootStep.id, status: 'pending' },
      data: { status: 'active' },
    })
    if (activated.count === 0) continue

    broadcastProjectEvent(projectId, 'step-activated', {
      taskId,
      stepId: rootStep.id,
    })

    // C-4: a chain can start ON a human gate — notify (never throws).
    if (rootStep.mode === 'human') {
      await notifyReviewGateWaiting({ projectId, taskId, stepId: rootStep.id, humanLabel: rootStep.humanLabel })
    }
  }

  // Resolve task status after all root activations
  await resolveTaskStatus(taskId, projectId)
}
