import { db } from '@/lib/db'

export async function traceToolCall(
  executionId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  durationMs: number,
  error?: string,
) {
  return db.toolCallTrace.create({
    data: {
      executionId,
      toolName,
      args: JSON.stringify(args),
      result: result.slice(0, 2000), // truncate large outputs
      durationMs,
      error: error || null,
    },
  })
}
