import { db } from '@/lib/db'

export const DEFAULT_PROJECT_MODES = [
  { name: 'analyze', label: 'Analyze', color: '#60A5FA', icon: '🔍', instructions: 'Investigate thoroughly. Gather evidence. Report findings with confidence levels.' },
  { name: 'verify', label: 'Verify', color: '#F59E0B', icon: '✅', instructions: 'Read-only verification. Check if the proposed solution is valid. Do NOT make changes.' },
  { name: 'develop', label: 'Develop', color: '#4ADE80', icon: '⚡', instructions: 'Implement the solution. Write code, run tests, document changes.' },
  { name: 'review', label: 'Review', color: '#2DD4BF', icon: '👁️', instructions: 'Review the output from the previous step for quality, correctness, and completeness.' },
  { name: 'draft', label: 'Draft', color: '#A78BFA', icon: '📝', instructions: 'Create initial content. Focus on structure and completeness over polish.' },
  { name: 'human', label: 'Human Review', color: '#9BAAC4', icon: '👤', instructions: null },
] as const

export async function seedProjectModes(projectId: string) {
  const existing = await db.projectMode.count({ where: { projectId } })
  if (existing > 0) return

  await db.projectMode.createMany({
    data: DEFAULT_PROJECT_MODES.map((mode) => ({
      projectId,
      name: mode.name,
      label: mode.label,
      color: mode.color,
      icon: mode.icon,
      instructions: mode.instructions,
    })),
  })
}

export async function ensureProjectModes(projectId: string) {
  const count = await db.projectMode.count({ where: { projectId } })
  if (count === 0) {
    await seedProjectModes(projectId)
  }
}
