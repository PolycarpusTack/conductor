import type { Trigger, Reaction } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { safeJsonParse } from '@/lib/server/utils'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { renderConfigMustache } from './mustache'
import { executeSlackReaction } from './types/slack'
import { executeHttpReaction } from './types/http'
import { executeJiraReaction } from './types/jira'
import { executeEmailReaction } from './types/email'

type ReactionOutput = Record<string, unknown>

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

async function dispatchReaction(type: string, config: Record<string, unknown>): Promise<ReactionOutput> {
  switch (type) {
    case 'post:slack':   return executeSlackReaction(config)
    case 'post:http':    return executeHttpReaction(config)
    case 'create:jira':  return executeJiraReaction(config)
    case 'send:email':   return executeEmailReaction(config)
    default: throw new Error(`Unknown reaction type: ${type}`)
  }
}

export async function executeReactions(
  trigger: Trigger & { reactions: Reaction[] },
  eventPayload: unknown,
  taskId: string | undefined,
): Promise<void> {
  const context: Record<string, unknown> = {
    event: eventPayload,
    reactions: {} as Record<string, unknown>,
  }

  for (const reaction of trigger.reactions) {
    const rawConfig = safeJsonParse<Record<string, unknown>>(reaction.config, {})
    const renderedConfig = renderConfigMustache(rawConfig, context)

    try {
      const output = await dispatchReaction(reaction.type, renderedConfig)
      ;(context.reactions as Record<string, unknown>)[sanitizeName(reaction.name)] = output

      await db.reaction.update({
        where: { id: reaction.id },
        data: { consecutiveFailures: 0, lastFiredAt: new Date(), lastError: null },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const newFailures = reaction.consecutiveFailures + 1

      await db.reaction.update({
        where: { id: reaction.id },
        data: {
          consecutiveFailures: newFailures,
          lastError: errorMessage,
          ...(newFailures >= 5 ? { enabled: false } : {}),
        },
      })

      if (taskId) {
        broadcastProjectEvent(trigger.projectId, 'reaction-failed', {
          taskId,
          triggerId: trigger.id,
          reactionId: reaction.id,
          reactionName: reaction.name,
          error: errorMessage,
        })
      }

      break
    }
  }
}
