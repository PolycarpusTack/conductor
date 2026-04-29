import { listEntries, getEntry } from './prompt-library'
import type { PromptLibraryEntry, PromptLibraryEntryFull } from '@/types/prompt-library'
import type { RuntimeAdapter } from '@/lib/server/adapters/types'
import { db } from '@/lib/db'
import { getAdapter } from '@/lib/server/adapters/registry'
import { safeJsonParse } from '@/lib/server/utils'

/** Scores an archive entry against a set of search terms (case-insensitive). Title matches score highest. */
export function scoreEntry(entry: PromptLibraryEntry, terms: string[]): number {
  const haystack = [entry.title, entry.category, entry.description]
    .join(' ')
    .toLowerCase()

  return terms.reduce((score, term) => {
    const t = term.toLowerCase()
    if (entry.title.toLowerCase().includes(t)) return score + 3
    if (entry.category.toLowerCase().includes(t)) return score + 2
    if (haystack.includes(t)) return score + 1
    return score
  }, 0)
}

/** Returns the top N archive entries most relevant to the given terms. Falls back to largest entries if nothing matches. */
export async function findRelevantEntries(terms: string[], topN = 3): Promise<PromptLibraryEntryFull[]> {
  const library = listEntries()
  const allEntries = library.categories.flatMap((c) => c.entries)

  const scored = allEntries
    .map((e) => ({ entry: e, score: scoreEntry(e, terms) }))
    .sort((a, b) => b.score - a.score || b.entry.charCount - a.entry.charCount)

  const top = scored.slice(0, topN).map((s) => s.entry)
  const full = top.map((e) => getEntry(e.id))
  return full.filter((e): e is PromptLibraryEntryFull => e !== null)
}

export interface ComposeRequest {
  purpose: string
  domain: string
  goal: string
  runtimeId: string
}

export interface ComposeResult {
  name: string
  role: string
  personality: string
  capabilities: string[]
  systemPrompt: string
  sourcesUsed: string[]
}

const COMPOSE_PROMPT = (req: ComposeRequest, sources: PromptLibraryEntryFull[]) => `
You are building a system prompt for an AI agent. The user has provided these requirements:

Purpose: ${req.purpose}
Domain/Stack: ${req.domain}
Primary goal: ${req.goal}

The following archive prompts are provided as reference material. Use them as inspiration — extract relevant patterns, rules, and heuristics, but compose a NEW prompt tailored to the requirements above. Do not copy them verbatim.

${sources.map((s, i) => `--- SOURCE ${i + 1}: ${s.title} ---\n${s.content}`).join('\n\n')}

---

Respond with ONLY a JSON object (no markdown fences) with this exact shape:
{
  "name": "short agent name (2-3 words)",
  "role": "one of: developer|architect|security|reviewer|qa|analyst|writer|researcher|support|custom",
  "personality": "one sentence describing voice and reasoning style (max 280 chars)",
  "capabilities": ["capability-slug-1", "capability-slug-2"],
  "systemPrompt": "the full system prompt (max 9500 chars, use {{agent.name}}, {{agent.role}}, {{agent.personality}}, {{agent.capabilities}}, {{task.title}}, {{task.description}}, {{memory.recent}}, {{memory.relevant}} as Mustache placeholders where appropriate)"
}
`.trim()

/** Resolves a ProjectRuntime record and its adapter, throwing if either is missing or unavailable. */
async function resolveRuntime(runtimeId: string) {
  const runtime = await db.projectRuntime.findUnique({ where: { id: runtimeId } })
  if (!runtime) throw new Error(`Runtime not found: ${runtimeId}`)

  const adapter = getAdapter(runtime.adapter)
  if (!adapter || !adapter.available) throw new Error(`Adapter "${runtime.adapter}" not available`)

  return { runtime, adapter }
}

/** Dispatches the compose prompt to the adapter and parses the JSON result. */
async function dispatchCompose(
  adapter: RuntimeAdapter,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>['runtime'],
  systemPrompt: string,
  purpose: string,
): Promise<Omit<ComposeResult, 'sourcesUsed'>> {
  const model = (safeJsonParse<string[]>(runtime.models, []))[0] ?? 'default'
  const runtimeConfig: Record<string, unknown> = {
    ...safeJsonParse<Record<string, unknown>>(runtime.config, {}),
    apiKeyEnvVar: runtime.apiKeyEnvVar,
    endpoint: runtime.endpoint,
  }

  const result = await adapter.dispatch({
    systemPrompt,
    taskContext: `Compose an agent for: ${purpose}`,
    mode: 'compose',
    model,
    runtimeConfig,
  })

  try {
    return JSON.parse(result.output) as Omit<ComposeResult, 'sourcesUsed'>
  } catch {
    const err = new Error('LLM_PARSE_FAILURE') as Error & { rawResponse?: string }
    err.rawResponse = result.output
    throw err
  }
}

/** Calls the configured ProjectRuntime LLM to compose agent fields from requirements. */
export async function composeAgent(req: ComposeRequest): Promise<ComposeResult> {
  const { runtime, adapter } = await resolveRuntime(req.runtimeId)

  const terms = [req.purpose, req.domain, req.goal].flatMap((s) => s.split(/\s+/)).filter(Boolean)
  const sources = await findRelevantEntries(terms, 3)

  const parsed = await dispatchCompose(adapter, runtime, COMPOSE_PROMPT(req, sources), req.purpose)

  return { ...parsed, sourcesUsed: sources.map((s) => s.id) }
}
