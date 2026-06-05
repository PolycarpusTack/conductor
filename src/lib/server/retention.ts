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
