// Bundled agent library (converted from the ClaudeExtras suites by
// scripts/convert-agent-library.py). ~100 ready-made agents with full system
// prompts, grouped by category, plus the chain-catalog workflows as
// chain-template definitions. Importing is idempotent: existing agent /
// template names in the project are skipped, never overwritten.

import libraryJson from '@/lib/server/agent-library/library.json'

import { db } from '@/lib/db'
import { getLogger } from '@/lib/server/logger'

const log = getLogger('agent-library')

export interface LibraryAgent {
  name: string
  category: string
  emoji: string
  color: string
  role: string
  description: string
  systemPrompt: string
}

export interface LibraryChainStep {
  agentRole: string
  mode: string
  instructions: string
  autoContinue: boolean
}

export interface LibraryChain {
  name: string
  icon: string
  description: string
  steps: LibraryChainStep[]
}

interface Library {
  version: string
  source: string
  agents: LibraryAgent[]
  chains: LibraryChain[]
}

export function getLibrary(): Library {
  return libraryJson as unknown as Library
}

/** Category summaries + lightweight agent/chain listings for the browse UI. */
export function getLibrarySummary() {
  const library = getLibrary()
  const categories = new Map<string, { name: string; emoji: string; count: number; agents: Array<{ name: string; description: string }> }>()
  for (const agent of library.agents) {
    const entry = categories.get(agent.category) ?? { name: agent.category, emoji: agent.emoji, count: 0, agents: [] }
    entry.count += 1
    entry.agents.push({ name: agent.name, description: agent.description })
    categories.set(agent.category, entry)
  }
  return {
    version: library.version,
    categories: [...categories.values()],
    chains: library.chains.map((c) => ({
      name: c.name,
      icon: c.icon,
      description: c.description,
      stepCount: c.steps.length,
    })),
  }
}

export interface ImportResult {
  agentsCreated: number
  agentsSkipped: number
  chainsCreated: number
  chainsSkipped: number
}

/**
 * Imports library agents (optionally filtered by category) and chain
 * templates into a project. Skips anything whose name already exists.
 */
export async function importLibrary(
  projectId: string,
  options: { categories?: string[]; includeChains?: boolean },
): Promise<ImportResult> {
  const library = getLibrary()
  const wanted = options.categories?.length
    ? library.agents.filter((a) => options.categories!.includes(a.category))
    : library.agents

  const existingAgents = await db.agent.findMany({
    where: { projectId },
    select: { name: true },
  })
  const existingNames = new Set(existingAgents.map((a) => a.name))

  const result: ImportResult = { agentsCreated: 0, agentsSkipped: 0, chainsCreated: 0, chainsSkipped: 0 }

  const toCreate = wanted.filter((a) => !existingNames.has(a.name))
  result.agentsSkipped = wanted.length - toCreate.length
  if (toCreate.length > 0) {
    await db.agent.createMany({
      data: toCreate.map((a) => ({
        projectId,
        name: a.name,
        emoji: a.emoji,
        color: a.color,
        role: a.role,
        category: a.category,
        description: a.description,
        systemPrompt: a.systemPrompt,
        isActive: false,
      })),
    })
    result.agentsCreated = toCreate.length
  }

  if (options.includeChains) {
    // Only import chains whose roles are all satisfiable by the requested
    // categories (or the whole library when unfiltered) — a chain that
    // references missing agents would silently stall at dispatch.
    const availableRoles = new Set(wanted.map((a) => a.role))
    const existingTemplates = await db.chainTemplate.findMany({
      where: { projectId },
      select: { name: true },
    })
    const existingTemplateNames = new Set(existingTemplates.map((t) => t.name))

    for (const chain of library.chains) {
      if (existingTemplateNames.has(chain.name)) {
        result.chainsSkipped += 1
        continue
      }
      if (!chain.steps.every((s) => availableRoles.has(s.agentRole))) {
        result.chainsSkipped += 1
        continue
      }
      await db.chainTemplate.create({
        data: {
          projectId,
          name: chain.name,
          description: chain.description || null,
          icon: chain.icon,
          steps: JSON.stringify(chain.steps),
        },
      })
      result.chainsCreated += 1
    }
  }

  log.info('library import', { projectId, ...result })
  return result
}
