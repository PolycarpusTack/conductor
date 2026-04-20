type ResolveContext = {
  task: { title: string; description?: string | null }
  step: { mode: string; instructions?: string | null; previousOutput?: string | null }
  mode: { label: string; instructions?: string | null }
  agent: { name: string; role?: string | null; capabilities?: string | null; personality?: string | null }
  memory?: { recent?: string | null; relevant?: string | null }
}

export function resolvePrompt(template: string, ctx: ResolveContext): string {
  const variables: Record<string, string> = {
    'task.title': ctx.task.title,
    'task.description': ctx.task.description || '',
    'step.mode': ctx.step.mode,
    'step.instructions': ctx.step.instructions || '',
    'step.previousOutput': ctx.step.previousOutput || '',
    'mode.label': ctx.mode.label,
    'mode.instructions': ctx.mode.instructions || '',
    'agent.name': ctx.agent.name,
    'agent.role': ctx.agent.role || '',
    'agent.capabilities': ctx.agent.capabilities || '',
    'agent.personality': ctx.agent.personality || '',
  }

  if (ctx.memory) {
    variables['memory.recent'] = ctx.memory.recent || ''
    variables['memory.relevant'] = ctx.memory.relevant || ''
  }

  return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key) => {
    return key in variables ? variables[key] : match
  })
}
