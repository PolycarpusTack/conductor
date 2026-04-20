import { db } from '@/lib/db'

type WorkingMemoryOpts = {
  agentId: string
  projectId: string
  maxRecent?: number
  maxCharsPerEntry?: number
}

/**
 * Tier 1: recent task outputs for this (agent, project).
 * Returns a formatted block to inject into the system prompt, or '' when empty.
 */
export async function buildWorkingMemory(opts: WorkingMemoryOpts): Promise<string> {
  const maxRecent = opts.maxRecent ?? 5
  const maxCharsPerEntry = opts.maxCharsPerEntry ?? 400

  const tasks = await db.task.findMany({
    where: {
      agentId: opts.agentId,
      projectId: opts.projectId,
      status: 'DONE',
    },
    orderBy: { completedAt: 'desc' },
    take: maxRecent,
    select: { title: true, output: true, completedAt: true },
  })

  if (tasks.length === 0) return ''

  const entries = tasks.map((t) => {
    const output = (t.output || '').slice(0, maxCharsPerEntry).trim()
    return `- ${t.title}${output ? `\n  ${output.replace(/\n/g, '\n  ')}` : ''}`
  })

  return `Recent work you've completed on this project:\n${entries.join('\n')}`
}
