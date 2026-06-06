import type { Trigger, Reaction } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scanForPromptInjection } from '@/lib/server/content-safety'
import { getLogger } from '@/lib/server/logger'
import { safeJsonParse } from '@/lib/server/utils'
import { broadcastProjectEvent } from '@/lib/server/realtime'
import { renderConfigMustache } from './mustache'
import { dispatchInternalReaction, type InternalReactionContext } from './internal'
import { executeSlackReaction } from './types/slack'
import { executeHttpReaction } from './types/http'
import { executeJiraReaction } from './types/jira'
import { executeEmailReaction } from './types/email'

const log = getLogger('reactions')

type ReactionOutput = Record<string, unknown>

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

async function dispatchReaction(
  type: string,
  config: Record<string, unknown>,
  ctx: InternalReactionContext,
): Promise<ReactionOutput> {
  // Internal actions (Epic S7) mutate Conductor state and need the context;
  // outbound types only see their rendered config.
  const internal = await dispatchInternalReaction(type, config, ctx)
  if (internal !== null) return internal

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
  // Trigger payloads can carry external content (Sentry messages, webhook
  // bodies) that gets mustache-rendered into reaction configs. Scan once and
  // expose the verdict to reaction templates as {{security.flagged}}.
  const safetyFlags = scanForPromptInjection(JSON.stringify(eventPayload ?? ''))
  if (safetyFlags.length > 0) {
    log.warn('prompt-injection patterns in trigger payload', {
      triggerId: trigger.id,
      categories: [...new Set(safetyFlags.map((f) => f.category))],
    })
  }

  const context: Record<string, unknown> = {
    event: eventPayload,
    reactions: {} as Record<string, unknown>,
    security: {
      flagged: safetyFlags.length > 0,
      categories: [...new Set(safetyFlags.map((f) => f.category))],
    },
  }

  const payloadRecord = (eventPayload ?? {}) as Record<string, unknown>
  const ctx: InternalReactionContext = {
    projectId: trigger.projectId,
    taskId,
    stepId: typeof payloadRecord.stepId === 'string' ? payloadRecord.stepId : undefined,
  }

  for (const reaction of trigger.reactions) {
    const rawConfig = safeJsonParse<Record<string, unknown>>(reaction.config, {})
    const renderedConfig = renderConfigMustache(rawConfig, context)

    try {
      // dryRun (Epic S7): log what would happen, execute nothing — applies to
      // every type so rules can be rehearsed before they're trusted.
      const output = reaction.dryRun
        ? { dryRun: true, wouldExecute: reaction.type, config: renderedConfig }
        : await dispatchReaction(reaction.type, renderedConfig, ctx)
      if (reaction.dryRun) {
        log.info(`dry-run: ${reaction.type} "${reaction.name}"`, { triggerId: trigger.id, config: renderedConfig })
      }
      ;(context.reactions as Record<string, unknown>)[`${reaction.order}_${sanitizeName(reaction.name)}`] = output

      await db.reaction.update({
        where: { id: reaction.id },
        data: { consecutiveFailures: 0, lastFiredAt: new Date(), lastError: null },
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const newFailures = reaction.consecutiveFailures + 1
      log.error(`${reaction.type} "${reaction.name}" failed`, errorMessage)

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
