import { createHash, randomBytes } from 'crypto'

import { getLogger } from '@/lib/server/logger'

const log = getLogger('api-keys')

import { db } from '@/lib/db'

type KeyKind = 'agent' | 'project'

type AgentAuthResult = {
  id: string
  name: string
  emoji: string
  projectId: string
}

// The legacy plaintext-key purge lives in ./legacy-key-purge (import it from
// there directly). It is deliberately NOT re-exported here: this module is
// module-mocked by several route tests, and a re-export makes those stubs
// shadow a real import of the purge functions through the shared bun registry.

function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function keyPrefix(kind: KeyKind) {
  return kind === 'agent' ? 'ab_agent' : 'ab_project'
}

export function buildApiKeyPreview(rawKey: string) {
  return `${rawKey.slice(0, 12)}...${rawKey.slice(-6)}`
}

function generateStructuredKey(kind: KeyKind, entityId: string) {
  const secret = randomBytes(24).toString('hex')
  const rawKey = `${keyPrefix(kind)}.${entityId}.${secret}`

  return {
    rawKey,
    hash: hashKey(rawKey),
    preview: buildApiKeyPreview(rawKey),
  }
}

export function createAgentApiKey(agentId: string) {
  return generateStructuredKey('agent', agentId)
}

export function createProjectApiKey(projectId: string) {
  return generateStructuredKey('project', projectId)
}

export function extractBearerToken(request: Request) {
  const authHeader = request.headers.get('authorization')

  if (!authHeader) {
    return null
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function extractAgentApiKey(
  request: Request,
  body?: Record<string, unknown> | null,
) {
  const bearerToken = extractBearerToken(request)
  if (bearerToken) {
    return bearerToken
  }

  const headerKey = request.headers.get('x-agent-key')?.trim()
  if (headerKey) {
    return headerKey
  }

  const bodyKey = typeof body?.api_key === 'string' ? body.api_key.trim() : ''
  return bodyKey || null
}

export async function resolveAgentByApiKey(rawKey: string): Promise<AgentAuthResult | null> {
  const hashedKey = hashKey(rawKey)

  const hashedAgent = await db.agent.findUnique({
    where: { apiKeyHash: hashedKey },
    select: {
      id: true,
      name: true,
      emoji: true,
      projectId: true,
    },
  })

  if (hashedAgent) {
    return hashedAgent
  }

  // Fallback: check legacy plaintext apiKey field for unmigrated agents
  const legacyAgent = await db.agent.findFirst({
    where: { apiKey: rawKey },
    select: {
      id: true,
      name: true,
      emoji: true,
      projectId: true,
    },
  })

  if (legacyAgent) {
    // DEPRECATION (G-3): a plaintext key was still stored for this agent. The
    // fallback is retained so unmigrated self-host installs keep working, but
    // it is a migration path, not a permanent affordance — run the one-shot
    // purge (`bun run scripts/purge-legacy-keys.ts`, or migrateLegacyApiKeys())
    // to hash + NULL every remaining plaintext key. Column drop is a follow-up.
    log.warn('legacy plaintext agent key resolved — auto-migrating; run purge-legacy-keys to eliminate plaintext keys', {
      agentId: legacyAgent.id,
    })
    // Auto-migrate this agent's key to hashed format
    await db.agent.update({
      where: { id: legacyAgent.id },
      data: {
        apiKey: null,
        apiKeyHash: hashedKey,
        apiKeyPreview: buildApiKeyPreview(rawKey),
      },
    }).catch((err) => log.error('failed to migrate legacy agent key', err, { agentId: legacyAgent.id }))

    return legacyAgent
  }

  return null
}
