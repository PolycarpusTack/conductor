/**
 * Shape of an entry in the client-side live-agent ring buffer.
 * Emitted by both daemon and HTTP-poll agents via the `agent-live-event`
 * socket broadcast; accumulated in page.tsx and fanned out to consumers
 * (Runtime Dashboard, Kanban activity tail).
 */
export type LiveAgentLogEntry = {
  source: 'daemon' | 'http'
  taskId: string
  stepId?: string
  daemonId?: string
  agentId?: string
  event: {
    type: 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'completed' | 'error'
    [key: string]: unknown
  }
  timestamp: string
}
