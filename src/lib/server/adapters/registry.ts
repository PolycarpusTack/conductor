import type { RuntimeAdapter } from './types'
import { anthropicAdapter } from './anthropic'
import { webhookAdapter } from './webhook'
import { zaiAdapter } from './zai'
import { googleAdapter } from './google'
import { openaiAdapter } from './openai'

function unavailableAdapter(id: string, name: string): RuntimeAdapter {
  return {
    id,
    name,
    available: false,
    async dispatch() {
      throw new Error(`${name} adapter is not yet available. Use the webhook adapter as an alternative.`)
    },
  }
}

const adapters = new Map<string, RuntimeAdapter>([
  ['anthropic', anthropicAdapter],
  ['openai', openaiAdapter],
  ['z-ai', zaiAdapter],
  ['google', googleAdapter],
  ['webhook', webhookAdapter],
  ['github-copilot', unavailableAdapter('github-copilot', 'GitHub Copilot')],
])

export function getAdapter(id: string): RuntimeAdapter | undefined {
  return adapters.get(id)
}

export function listAdapters(): RuntimeAdapter[] {
  return Array.from(adapters.values())
}
