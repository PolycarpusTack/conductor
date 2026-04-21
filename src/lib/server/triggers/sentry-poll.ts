import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/server/utils'
import { executeReactions } from '@/lib/server/reactions/executor'

type SentryPollConfig = {
  apiTokenEnvVar: string
  orgSlug: string
  projectSlug: string
  environment?: string
}

type SentryIssue = {
  id: string
  title: string
  permalink: string
  level: string
  culprit: string
  firstSeen: string
  lastSeen: string
}

export async function pollSentryTriggers(): Promise<void> {
  const triggers = await db.trigger.findMany({
    where: { type: 'poll:sentry', enabled: true },
    include: { reactions: { where: { enabled: true }, orderBy: { order: 'asc' } } },
  })

  for (const trigger of triggers) {
    const config = safeJsonParse<SentryPollConfig>(trigger.pollConfig, {} as SentryPollConfig)
    const apiToken = config.apiTokenEnvVar ? process.env[config.apiTokenEnvVar] : undefined

    if (!apiToken || !config.orgSlug || !config.projectSlug) continue

    const since = trigger.lastFiredAt
      ? trigger.lastFiredAt.toISOString()
      : new Date(Date.now() - 60_000).toISOString()

    const url = new URL(
      `https://sentry.io/api/0/projects/${encodeURIComponent(config.orgSlug)}/${encodeURIComponent(config.projectSlug)}/issues/`,
    )
    url.searchParams.set('query', `firstSeen:>${since}`)
    if (config.environment) url.searchParams.set('environment', config.environment)

    let issues: SentryIssue[]
    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiToken}` },
      })
      if (!res.ok) continue
      issues = (await res.json()) as SentryIssue[]
    } catch {
      continue
    }

    for (const issue of issues) {
      const payload = {
        id: issue.id,
        title: issue.title,
        url: issue.permalink,
        level: issue.level,
        culprit: issue.culprit,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
      }
      await executeReactions(trigger, payload, undefined)
    }

    if (issues.length > 0) {
      await db.trigger.update({ where: { id: trigger.id }, data: { lastFiredAt: new Date() } })
    }
  }
}
