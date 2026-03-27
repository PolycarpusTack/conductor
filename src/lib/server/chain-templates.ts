import { db } from '@/lib/db'

const DEFAULT_CHAIN_TEMPLATES = [
  {
    name: 'Support Investigation',
    description: 'Analyze → verify → human review → fix → approve',
    icon: '🛡️',
    steps: [
      { agentRole: 'support', mode: 'analyze', autoContinue: true },
      { agentRole: 'developer', mode: 'verify', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
      { agentRole: 'developer', mode: 'develop', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Documentation',
    description: 'Draft → review → revise → approve',
    icon: '📝',
    steps: [
      { agentRole: 'writer', mode: 'draft', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
      { agentRole: 'writer', mode: 'review', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Feature Investigation',
    description: 'Analyze → verify feasibility → decide',
    icon: '🔎',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true },
      { agentRole: 'developer', mode: 'verify', autoContinue: true },
      { humanLabel: 'Product Owner', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Bug Fix',
    description: 'Analyze → fix → QA → approve',
    icon: '🐛',
    steps: [
      { agentRole: 'developer', mode: 'analyze', autoContinue: true },
      { agentRole: 'developer', mode: 'develop', autoContinue: true },
      { agentRole: 'qa', mode: 'verify', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Code Review',
    description: 'Review → approve',
    icon: '👁️',
    steps: [
      { agentRole: 'developer', mode: 'review', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
]

export async function seedChainTemplates(projectId: string) {
  const existing = await db.chainTemplate.count({ where: { projectId } })
  if (existing > 0) return

  for (const template of DEFAULT_CHAIN_TEMPLATES) {
    await db.chainTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        icon: template.icon,
        projectId,
        steps: JSON.stringify(template.steps),
      },
    })
  }
}
