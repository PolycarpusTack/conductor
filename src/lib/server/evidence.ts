import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/server/utils'

/**
 * Step evidence packets: "what did this agent rely on?" assembled on read
 * from the relational sources that already exist — executions (with the
 * retrieval evidence dispatch captured), tool call traces, artifacts, the
 * append-only step event log, sessions, and task messages.
 */

export interface StepEvidencePacket {
  taskId: string
  stepId: string
  executions: Array<{
    id: string
    attempt: number
    status: string
    tokensUsed: number | null
    cost: number | null
    durationMs: number | null
    memoryHits: Array<{ id: string; category: string }>
    workingMemory: boolean
    toolCalls: Array<{
      toolName: string
      durationMs: number | null
      error: string | null
    }>
  }>
  artifacts: Array<{ id: string; type: string; label: string }>
  events: Array<{ id: string; event: string; data: Record<string, unknown> | null; createdAt: Date }>
  sessions: Array<{
    id: string
    sessionKey: string
    backend: string
    status: string
    hostId: string | null
    exitCode: number | null
  }>
  messages: Array<{
    id: string
    fromAddress: string
    toAddress: string
    subject: string | null
    status: string
    flagged: boolean
  }>
  safetyFlags: Array<{ source: string; category: string }>
  /** Session ids referenced anywhere (rows + event data). */
  sessionIds: string[]
}

/** Assembles the evidence packet; null when the step isn't part of the task. */
export async function assembleStepEvidence(
  taskId: string,
  stepId: string,
): Promise<StepEvidencePacket | null> {
  const step = await db.taskStep.findUnique({
    where: { id: stepId },
    select: { taskId: true },
  })
  if (!step || step.taskId !== taskId) return null

  const [executions, artifacts, events, sessions, messages] = await Promise.all([
    db.stepExecution.findMany({
      where: { stepId },
      orderBy: { attempt: 'asc' },
      include: { toolCalls: { orderBy: { createdAt: 'asc' } } },
    }),
    db.stepArtifact.findMany({
      where: { stepId },
      select: { id: true, type: true, label: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.stepEvent.findMany({ where: { stepId }, orderBy: { createdAt: 'asc' } }),
    db.agentSession.findMany({
      where: { stepId },
      select: { id: true, sessionKey: true, backend: true, status: true, hostId: true, exitCode: true },
    }),
    db.agentMessage.findMany({
      where: { taskId, OR: [{ stepId }, { stepId: null }] },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
  ])

  const parsedEvents = events.map((e) => ({
    id: e.id,
    event: e.event,
    data: safeJsonParse<Record<string, unknown> | null>(e.data, null),
    createdAt: e.createdAt,
  }))

  // Sessions referenced by rows OR by step events (daemon completion linkage)
  const sessionIds = new Set<string>(sessions.map((s) => s.id))
  for (const e of parsedEvents) {
    const sid = e.data?.sessionId
    if (typeof sid === 'string') sessionIds.add(sid)
  }

  const safetyFlags: StepEvidencePacket['safetyFlags'] = []
  const packetMessages = messages.map((m) => {
    const security = safeJsonParse<{ flags?: Array<{ category: string }> }>(m.bodySecurity, {})
    const flags = security.flags ?? []
    for (const flag of flags) {
      safetyFlags.push({ source: `message:${m.fromAddress}`, category: flag.category })
    }
    return {
      id: m.id,
      fromAddress: m.fromAddress,
      toAddress: m.toAddress,
      subject: m.subject,
      status: m.status,
      flagged: flags.length > 0,
    }
  })

  return {
    taskId,
    stepId,
    executions: executions.map((execution) => {
      const evidence = safeJsonParse<{
        memoryHits?: Array<{ id: string; category: string }>
        workingMemory?: boolean
      }>(execution.evidence, {})
      return {
        id: execution.id,
        attempt: execution.attempt,
        status: execution.status,
        tokensUsed: execution.tokensUsed,
        cost: execution.cost,
        durationMs: execution.durationMs,
        memoryHits: evidence.memoryHits ?? [],
        workingMemory: evidence.workingMemory ?? false,
        toolCalls: execution.toolCalls.map((t) => ({
          toolName: t.toolName,
          durationMs: t.durationMs,
          error: t.error,
        })),
      }
    }),
    artifacts,
    events: parsedEvents,
    sessions,
    messages: packetMessages,
    safetyFlags,
    sessionIds: [...sessionIds],
  }
}
