import { db } from '@/lib/db'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogComponent = 'task' | 'agent' | 'daemon' | 'wizard' | 'runtime' | 'system'

export interface WriteLogInput {
  projectId: string
  action: string
  level?: LogLevel
  component?: LogComponent
  taskId?: string
  agentId?: string
  traceId?: string
  details?: Record<string, unknown>
}

export async function writeLog(input: WriteLogInput): Promise<void> {
  await db.activityLog.create({
    data: {
      projectId: input.projectId,
      action: input.action,
      level: input.level ?? 'info',
      component: input.component ?? null,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      traceId: input.traceId ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
    },
  })
}

export async function purgeOldLogs(projectId: string, retentionDays: number): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)

  const result = await db.activityLog.deleteMany({
    where: { projectId, createdAt: { lt: cutoff } },
  })

  return result.count
}

export async function purgeProjectLogs(projectId: string): Promise<number | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { logRetentionDays: true },
  })

  if (!project || project.logRetentionDays === null) return null

  return purgeOldLogs(projectId, project.logRetentionDays)
}
