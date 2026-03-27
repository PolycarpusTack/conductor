import { createHash, randomBytes, timingSafeEqual } from 'crypto'

import { db } from '@/lib/db'

type KeyKind = 'agent' | 'project'

type AgentAuthResult = {
  id: string
  name: string
  emoji: string
  projectId: string
}

type LegacyApiKeyStatus = {
  projectsWithPlaintext: number
  agentsWithPlaintext: number
  totalWithPlaintext: number
}

function hashKey(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
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

function parseStructuredKey(rawKey: string, kind: KeyKind) {
  const [prefix, entityId] = rawKey.split('.', 3)
  if (prefix !== keyPrefix(kind) || !entityId) {
    return null
  }

  return { entityId }
}

export function createAgentApiKey(agentId: string) {
  return generateStructuredKey('agent', agentId)
}

export function createProjectApiKey(projectId: string) {
  return generateStructuredKey('project', projectId)
}

function extractBearerToken(request: Request) {
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
    // Auto-migrate this agent's key to hashed format
    await db.agent.update({
      where: { id: legacyAgent.id },
      data: {
        apiKey: null,
        apiKeyHash: hashedKey,
        apiKeyPreview: buildApiKeyPreview(rawKey),
      },
    }).catch(console.error)

    return legacyAgent
  }

  return null
}

export async function getLegacyApiKeyStatus(): Promise<LegacyApiKeyStatus> {
  const [projectsWithPlaintext, agentsWithPlaintext] = await Promise.all([
    db.project.count({ where: { apiKey: { not: null } } }),
    db.agent.count({ where: { apiKey: { not: null } } }),
  ])

  return {
    projectsWithPlaintext,
    agentsWithPlaintext,
    totalWithPlaintext: projectsWithPlaintext + agentsWithPlaintext,
  }
}

export async function migrateLegacyApiKeys() {
  const [projects, agents] = await Promise.all([
    db.project.findMany({
      where: { apiKey: { not: null } },
      select: { id: true, apiKey: true, apiKeyPreview: true },
    }),
    db.agent.findMany({
      where: { apiKey: { not: null } },
      select: { id: true, apiKey: true, apiKeyPreview: true },
    }),
  ])

  const updates = [
    ...projects.flatMap((project) =>
      project.apiKey
        ? [
            db.project.update({
              where: { id: project.id },
              data: {
                apiKey: null,
                apiKeyHash: hashKey(project.apiKey),
                apiKeyPreview: project.apiKeyPreview || buildApiKeyPreview(project.apiKey),
              },
            }),
          ]
        : [],
    ),
    ...agents.flatMap((agent) =>
      agent.apiKey
        ? [
            db.agent.update({
              where: { id: agent.id },
              data: {
                apiKey: null,
                apiKeyHash: hashKey(agent.apiKey),
                apiKeyPreview: agent.apiKeyPreview || buildApiKeyPreview(agent.apiKey),
              },
            }),
          ]
        : [],
    ),
  ]

  if (updates.length > 0) {
    await db.$transaction(updates)
  }

  return {
    migratedProjects: projects.length,
    migratedAgents: agents.length,
    totalMigrated: projects.length + agents.length,
    status: await getLegacyApiKeyStatus(),
  }
}
