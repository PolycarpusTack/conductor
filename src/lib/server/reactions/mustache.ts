import Mustache from 'mustache'

export function renderMustache(template: string, context: unknown): string {
  return Mustache.render(template, context)
}

export function renderConfigMustache(
  config: Record<string, unknown>,
  context: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      result[key] = renderMustache(value, context)
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = renderConfigMustache(value as Record<string, unknown>, context)
    } else {
      result[key] = value
    }
  }
  return result
}
