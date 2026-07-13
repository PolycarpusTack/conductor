// ADR-0010: write-time validation for attaching skills to an agent.
// Skills are workspace-scoped; agents are project-scoped. An attach is legal
// only when every skill lives in the agent's project's workspace.

import { db } from '@/lib/db'

/** Returns an error message when the attach is illegal, null when fine. */
export async function validateSkillAttach(
  skillIds: string[],
  projectId: string,
): Promise<string | null> {
  if (skillIds.length === 0) return null

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  })
  if (!project) return 'Project not found'
  if (!project.workspaceId) {
    return 'Project has no workspace — assign one before attaching skills (skills are workspace-scoped)'
  }

  const found = await db.skill.findMany({
    where: { id: { in: skillIds }, workspaceId: project.workspaceId },
    select: { id: true },
  })
  const foundIds = new Set(found.map(s => s.id))
  const missing = skillIds.filter(id => !foundIds.has(id))
  if (missing.length > 0) {
    return `Skill(s) not found in the project's workspace: ${missing.join(', ')}`
  }
  return null
}
