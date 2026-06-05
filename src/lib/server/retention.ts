import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('retention')

/**
 * Artifact retention (Epic S1). Follows the activity-log pattern: lazy,
 * fire-and-forget purges triggered from hot read paths rather than a cron.
 *
 * Only artifacts belonging to DONE tasks are eligible — in-flight and
 * review-stage work keeps its artifacts regardless of age.
 */
/** Grace period before soft-deleted tasks are hard-purged (Epic S3). */
export const DELETED_TASK_GRACE_DAYS = 30

/**
 * Hard-deletes tasks whose soft-delete grace period has lapsed; the cascade
 * removes their steps, executions, and artifacts. Lazy + best-effort.
 */
export async function purgeDeletedTasks(projectId: string): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - DELETED_TASK_GRACE_DAYS * 24 * 60 * 60 * 1000)
    const result = await db.task.deleteMany({
      where: { projectId, deletedAt: { lt: cutoff } },
    })
    if (result.count > 0) {
      log.info('hard-purged soft-deleted tasks past grace period', { projectId, count: result.count })
    }
    return result.count
  } catch (err) {
    log.warn('deleted-task purge failed', { projectId, err: String(err) })
    return null
  }
}

export async function purgeProjectArtifacts(projectId: string): Promise<number | null> {
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { artifactRetentionDays: true },
    })
    if (!project?.artifactRetentionDays) return null

    const cutoff = new Date(Date.now() - project.artifactRetentionDays * 24 * 60 * 60 * 1000)

    const result = await db.stepArtifact.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        step: { task: { projectId, status: 'DONE' } },
      },
    })

    if (result.count > 0) {
      log.info('purged artifacts past retention', { projectId, count: result.count })
    }
    return result.count
  } catch (err) {
    log.warn('artifact purge failed', { projectId, err: String(err) })
    return null
  }
}
